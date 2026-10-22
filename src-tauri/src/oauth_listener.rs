//! Bounded loopback OAuth transport. Callback authentication precedes event delivery.
use std::io;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use tokio::task::{JoinHandle, JoinSet};

struct Run {
    cancel: oneshot::Sender<()>,
    task: JoinHandle<()>,
}
pub struct OAuthServer {
    active: Mutex<Option<Run>>,
}
impl OAuthServer {
    pub const fn new() -> Self {
        Self {
            active: Mutex::const_new(None),
        }
    }
    pub async fn cancel(&self) {
        let mut active = self.active.lock().await;
        if let Some(run) = active.take() {
            let _ = run.cancel.send(());
            let _ = run.task.await;
        }
    }
    pub async fn start(
        &self,
        address: &str,
        state: String,
        emit: impl FnOnce(String) + Send + 'static,
    ) -> io::Result<SocketAddr> {
        if !(32..=128).contains(&state.len())
            || !state
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid OAuth state",
            ));
        }
        let mut active = self.active.lock().await;
        if let Some(run) = active.take() {
            let _ = run.cancel.send(());
            let _ = run.task.await;
        }
        let listener = TcpListener::bind(address).await?;
        let address = listener.local_addr()?;
        let (cancel, cancellation) = oneshot::channel();
        let task = tokio::spawn(async move {
            if let Some(url) = wait_callback(
                listener,
                state,
                cancellation,
                Duration::from_secs(180),
                Duration::from_secs(2),
            )
            .await
            {
                emit(url);
            }
        });
        *active = Some(Run { cancel, task });
        Ok(address)
    }
}

fn parse_request(request: &[u8], expected: &str) -> Option<String> {
    let text = std::str::from_utf8(request).ok()?;
    let mut parts = text.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/callback?") || target.contains('#') {
        return None;
    }
    if !matches!(parts.next()?, "HTTP/1.0" | "HTTP/1.1") || parts.next().is_some() {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:8888{target}")).ok()?;
    if url.path() != "/callback" {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let values = |name: &str| {
        pairs
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.as_ref())
            .collect::<Vec<_>>()
    };
    if values("state") != [expected] {
        return None;
    }
    let codes = values("code");
    let errors = values("error");
    if !((codes.len() == 1 && !codes[0].is_empty() && errors.is_empty())
        || (errors.len() == 1 && !errors[0].is_empty() && codes.is_empty()))
    {
        return None;
    }
    Some(url.into())
}

async fn handle_connection(mut stream: TcpStream, expected: String) -> Option<String> {
    let mut request = Vec::new();
    let mut chunk = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 || request.len() + read > 8192 {
            return None;
        }
        request.extend_from_slice(&chunk[..read]);
    }
    let callback = parse_request(&request, &expected);
    let (status, body) = if callback.is_some() {
        ("200 OK", "Authorization received. Return to Lyrical Sync.")
    } else {
        ("400 Bad Request", "Invalid OAuth callback.")
    };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes()).await;
    callback
}

async fn wait_callback(
    listener: TcpListener,
    expected: String,
    mut cancellation: oneshot::Receiver<()>,
    lifetime: Duration,
    request_timeout: Duration,
) -> Option<String> {
    let deadline = tokio::time::sleep(lifetime);
    tokio::pin!(deadline);
    let mut clients = JoinSet::new();
    let result = loop {
        tokio::select! {
            biased;
            _ = &mut cancellation => break None,
            _ = &mut deadline => break None,
            result = clients.join_next(), if !clients.is_empty() => {
                if let Some(Ok(Some(callback))) = result { break Some(callback); }
            }
            accepted = listener.accept(), if clients.len() < 8 => {
                match accepted {
                    Ok((stream, _)) => {
                        let state = expected.clone();
                        clients.spawn(async move {
                            tokio::time::timeout(request_timeout, handle_connection(stream, state)).await.ok().flatten()
                        });
                    }
                    Err(_) => break None,
                }
            }
        }
    };
    clients.shutdown().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    const STATE: &str = "0123456789abcdef0123456789abcdef";
    fn request(target: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n")
    }

    #[test]
    fn only_auth_callbacks_with_the_expected_unique_state_are_accepted() {
        assert!(parse_request(
            request(&format!("/callback?code=ok&state={STATE}")).as_bytes(),
            STATE
        )
        .is_some());
        assert!(parse_request(
            request(&format!("/callback?error=access_denied&state={STATE}")).as_bytes(),
            STATE
        )
        .is_some());
        for target in [
            "/favicon.ico",
            "/callback?code=x&state=wrong",
            "/callback?state=0123456789abcdef0123456789abcdef",
            "/callback?code=x&state=0123456789abcdef0123456789abcdef&state=wrong",
            "/callback?code=x&error=x&state=0123456789abcdef0123456789abcdef",
        ] {
            assert!(
                parse_request(request(target).as_bytes(), STATE).is_none(),
                "{target}"
            );
        }
        assert!(parse_request(
            format!("POST /callback?code=x&state={STATE} HTTP/1.1\r\n\r\n").as_bytes(),
            STATE
        )
        .is_none());
    }

    async fn send(address: std::net::SocketAddr, target: &str) -> Vec<u8> {
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        stream.write_all(request(target).as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        response
    }

    #[test]
    fn idle_and_unrelated_connections_do_not_consume_the_callback() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (_cancel, cancellation) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(wait_callback(
                listener,
                STATE.into(),
                cancellation,
                Duration::from_secs(3),
                Duration::from_secs(2),
            ));
            let _idle = tokio::net::TcpStream::connect(address).await.unwrap();
            assert!(String::from_utf8(send(address, "/favicon.ico").await)
                .unwrap()
                .starts_with("HTTP/1.1 400"));
            send(address, &format!("/callback?code=ok&state={STATE}")).await;
            let result = tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap();
            assert!(result.unwrap().contains("code=ok"));
        });
    }

    #[test]
    fn expiry_closes_idle_clients_and_releases_the_port() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (_cancel, cancellation) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(wait_callback(
                listener,
                STATE.into(),
                cancellation,
                Duration::from_millis(100),
                Duration::from_secs(2),
            ));
            let _idle = tokio::net::TcpStream::connect(address).await.unwrap();
            assert!(tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .unwrap()
                .unwrap()
                .is_none());
            assert!(TcpListener::bind(address).await.is_ok());
        });
    }

    #[test]
    fn retry_cancels_the_previous_login_and_rebinds_the_port() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let server = OAuthServer::new();
            let (old_tx, mut old_rx) = tokio::sync::oneshot::channel();
            let address = server
                .start("127.0.0.1:0", STATE.into(), move |url| {
                    let _ = old_tx.send(url);
                })
                .await
                .unwrap();
            let _idle = tokio::net::TcpStream::connect(address).await.unwrap();
            let (new_tx, new_rx) = tokio::sync::oneshot::channel();
            server
                .start(
                    &address.to_string(),
                    "fedcba9876543210fedcba9876543210".into(),
                    move |url| {
                        let _ = new_tx.send(url);
                    },
                )
                .await
                .unwrap();
            send(address, &format!("/callback?code=old&state={STATE}")).await;
            send(
                address,
                "/callback?code=new&state=fedcba9876543210fedcba9876543210",
            )
            .await;
            assert!(tokio::time::timeout(Duration::from_secs(1), new_rx)
                .await
                .unwrap()
                .unwrap()
                .contains("code=new"));
            assert!(old_rx.try_recv().is_err());
            server.cancel().await;
            assert!(TcpListener::bind(address).await.is_ok());
        });
    }
}
