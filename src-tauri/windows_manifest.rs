/// Render the embedded assembly identity for the compiled target, not the host.
pub fn render(source: &str, architecture: &str) -> Result<String, &'static str> {
    let value = match architecture {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => return Err("Unsupported Windows assembly architecture"),
    };
    let marker = "processorArchitecture=\"amd64\"";
    if source.matches(marker).count() != 1 {
        return Err("Incompatible Windows assembly manifest template");
    }
    Ok(source.replacen(marker, &format!("processorArchitecture=\"{value}\""), 1))
}
