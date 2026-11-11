use std::future::Future;
use std::time::Duration;

async fn with_timeout<T>(
    future: impl Future<Output = Result<T, String>>,
    timeout: Duration,
) -> Result<T, String> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| "device_command_timeout".to_string())?
}

pub(crate) async fn run_bounded_worker<I, G, MakeFuture, Fut, T>(
    initialize: I,
    make_future: MakeFuture,
    timeout: Duration,
) -> Result<T, String>
where
    I: FnOnce() -> Result<G, String> + Send + 'static,
    G: 'static,
    MakeFuture: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let _scope = initialize()?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .map_err(|error| format!("device_worker_runtime_failed: {error}"))?;
        runtime.block_on(with_timeout(make_future(), timeout))
    })
    .await
    .map_err(|error| format!("device_worker_failed: {error}"))?
}

#[cfg(target_os = "windows")]
pub(crate) struct ComApartment;

#[cfg(target_os = "windows")]
impl ComApartment {
    pub(crate) fn initialize() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        // S_OK and S_FALSE both establish this thread's MTA participation and require
        // a matching CoUninitialize. RPC_E_CHANGED_MODE must fail closed.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .map(|| Self)
            .map_err(|error| format!("device_com_initialization_failed: {error}"))
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        use windows::Win32::System::Com::CoUninitialize;
        unsafe { CoUninitialize() };
    }
}

#[cfg(test)]
mod tests {
    use super::run_bounded_worker;
    use std::sync::{Arc, Mutex};
    use std::thread::ThreadId;
    use std::time::Duration;

    #[tokio::test]
    async fn bounded_worker_initializes_and_polls_operation_on_one_thread() {
        let thread_ids = Arc::new(Mutex::new(Vec::<ThreadId>::new()));
        let initialized = Arc::clone(&thread_ids);
        let polled = Arc::clone(&thread_ids);
        let result = run_bounded_worker(
            move || {
                initialized
                    .lock()
                    .unwrap()
                    .push(std::thread::current().id());
                Ok(())
            },
            move || async move {
                polled.lock().unwrap().push(std::thread::current().id());
                tokio::task::yield_now().await;
                polled.lock().unwrap().push(std::thread::current().id());
                Ok::<_, String>(())
            },
            Duration::from_secs(1),
        )
        .await;

        assert!(result.is_ok());
        let thread_ids = thread_ids.lock().unwrap();
        assert_eq!(thread_ids.len(), 3);
        assert!(thread_ids.iter().all(|id| *id == thread_ids[0]));
    }

    #[tokio::test]
    async fn bounded_worker_keeps_timeout_inside_the_worker_scope() {
        struct DropFlag(Arc<Mutex<bool>>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                *self.0.lock().unwrap() = true;
            }
        }

        let dropped = Arc::new(Mutex::new(false));
        let drop_flag = Arc::clone(&dropped);
        let result = run_bounded_worker(
            move || Ok(DropFlag(drop_flag)),
            || async { std::future::pending::<Result<(), String>>().await },
            Duration::from_millis(10),
        )
        .await;

        assert_eq!(result.unwrap_err(), "device_command_timeout");
        assert!(*dropped.lock().unwrap());
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::{run_bounded_worker, ComApartment};
    use std::time::Duration;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    #[test]
    fn com_mta_initialization_balances_nested_successes() {
        let first = ComApartment::initialize().expect("first MTA initialization");
        let second = ComApartment::initialize().expect("nested MTA initialization");
        drop(second);
        drop(first);

        let after_cleanup = ComApartment::initialize().expect("MTA is balanced after cleanup");
        drop(after_cleanup);
    }

    #[test]
    fn com_mta_initialization_rejects_an_existing_sta() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .map(|| ())
            .expect("initialize the test thread as STA");
        let result = ComApartment::initialize();
        unsafe { CoUninitialize() };

        assert!(
            result.is_err(),
            "MTA initialization must reject an STA thread"
        );
    }

    #[tokio::test]
    async fn winrt_media_session_manager_can_be_queried_inside_the_worker() {
        let result = run_bounded_worker(
            ComApartment::initialize,
            || async {
                let operation =
                    match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                        Ok(operation) => operation,
                        Err(error) if error.code().0 == 0x8007_0424u32 as i32 => return Ok(None),
                        Err(error) => return Err(error.to_string()),
                    };
                let manager = match operation.await {
                    Ok(manager) => manager,
                    Err(error) if error.code().0 == 0x8007_0424u32 as i32 => return Ok(None),
                    Err(error) => return Err(error.to_string()),
                };
                Ok(Some(manager.GetCurrentSession().is_ok()))
            },
            Duration::from_secs(5),
        )
        .await;

        assert!(result.is_ok(), "WinRT query failed: {result:?}");
    }
}
