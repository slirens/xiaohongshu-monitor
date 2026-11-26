use tauri::WebviewWindow;

#[tauri::command]
fn verify_preview() -> bool {
    std::env::args_os().any(|argument| argument == "--verify-preview")
}

#[tauri::command]
fn preview_ready(window: WebviewWindow) {
    if window.label() == "main" {
        println!("PREVIEW_READY main");
    }
}

#[tauri::command]
fn webview_ready(window: WebviewWindow, proof: String) -> Result<(), String> {
    if window.label() != "main" || proof.len() > 320 {
        return Err("Unexpected readiness proof".into());
    }
    println!("WEBVIEW_READY {} {}", window.label(), proof);
    Ok(())
}

#[tauri::command]
fn webview_failed(window: WebviewWindow, reason: String) {
    if window.label() == "main" {
        eprintln!("WEBVIEW_FAILED {}", reason.chars().take(320).collect::<String>());
    }
}

fn main() {
    tauri::Builder::default()
        .on_page_load(|window, payload| {
            println!("WEBVIEW_PAGE_LOAD {} {:?}", window.label(), payload.event());
        })
        .invoke_handler(tauri::generate_handler![
            verify_preview,
            preview_ready,
            webview_ready,
            webview_failed
        ])
        .run(tauri::generate_context!())
        .expect("Could not launch the F interface preview");
}
