fn main() {
    // App commands are ACL-gated: the setup window and the remote console each get only what they need
    // (capabilities/setup.json and the runtime capability in lib.rs::allow_remote).
    let manifest = tauri_build::AppManifest::new().commands(&["get_server_url", "set_server_url", "notify", "set_unread"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
