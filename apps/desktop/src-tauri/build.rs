fn main() {
    #[cfg(target_os = "macos")]
    compile_macos_chrome();
    tauri_build::build();
}

#[cfg(target_os = "macos")]
fn compile_macos_chrome() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let src = manifest.join("src/macos_chrome.m");
    println!("cargo:rerun-if-changed={}", src.display());

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let obj = out.join("macos_chrome.o");
    let lib = out.join("libpolarr_macos_chrome.a");

    let status = Command::new("clang")
        .args(["-c", "-fobjc-arc"])
        .arg(&src)
        .arg("-o")
        .arg(&obj)
        .status()
        .expect("clang (Objective-C)");
    if !status.success() {
        panic!("clang failed to compile src/macos_chrome.m");
    }

    let status = Command::new("ar")
        .args(["crus"])
        .arg(&lib)
        .arg(&obj)
        .status()
        .expect("ar");
    if !status.success() {
        panic!("ar failed to archive macos chrome object");
    }

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=polarr_macos_chrome");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
}
