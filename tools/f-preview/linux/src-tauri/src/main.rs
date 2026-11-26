fn main() {
    tauri::Builder::default()
        .on_page_load(|window, payload| {
            println!("F_PREVIEW_WEBVIEW {} {:?}", window.label(), payload.event());
        })
        .run(tauri::generate_context!())
        .expect("Failed to start the XHS Monitor F Preview");
}
