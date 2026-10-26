//! Hotline desktop: a Windows shell around the hosted agent console (the `web/` app).
//! The console runs on the server; this app only adds native toasts, a taskbar badge and a tray.
mod config;
mod notify;
mod tray;

use tauri::{
    ipc::CapabilityBuilder, webview::NewWindowResponse, AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

/// The console window (remote server URL).
pub const MAIN: &str = "main";
/// The local "which server?" page (src/index.html).
pub const SETUP: &str = "setup";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| match app.get_webview_window(MAIN) {
            Some(_) => show_main(app),
            None => open_setup(app),
        }))
        .invoke_handler(tauri::generate_handler![
            config::get_server_url,
            config::set_server_url,
            notify::notify,
            notify::set_unread
        ])
        .setup(|app| {
            let handle = app.handle();
            tray::create(handle)?;
            match config::load(handle).server_url {
                Some(origin) => open_console(handle, &origin)?,
                None => open_setup(handle),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the console hides it to the tray; "ออก" in the tray menu quits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Hotline");
}

/// Lets pages from `origin` (and only them) call the two console commands.
fn allow_remote(app: &AppHandle, origin: &str) -> tauri::Result<()> {
    app.add_capability(
        CapabilityBuilder::new(format!("console-{origin}"))
            .window(MAIN)
            .remote(format!("{origin}/*"))
            .permission("allow-notify")
            .permission("allow-set-unread"),
    )
}

/// Points the console window at `origin`, creating it on first use.
pub(crate) fn open_console(app: &AppHandle, origin: &str) -> tauri::Result<()> {
    let url: Url = origin.parse().map_err(|_| tauri::Error::InvalidWebviewUrl("server url"))?;
    allow_remote(app, origin)?;
    if let Some(win) = app.get_webview_window(MAIN) {
        win.navigate(url)?;
        show_main(app);
        return Ok(());
    }
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(url))
        .title("Hotline")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 600.0)
        // target="_blank" links (images and files in chats) open in the default browser.
        .on_new_window(|url, _| {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

pub(crate) fn open_setup(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SETUP) {
        let _ = win.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETUP, WebviewUrl::App("index.html".into()))
        .title("ตั้งค่าเซิร์ฟเวอร์ — Hotline")
        .inner_size(480.0, 400.0)
        .resizable(false)
        .center()
        .build();
    if let Err(err) = built {
        eprintln!("failed to open setup window: {err}");
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
