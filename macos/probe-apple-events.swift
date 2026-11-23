import AppKit
import CoreServices

for identifier in ["com.apple.Safari", "com.apple.finder"] {
    let applications = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
        .filter { !$0.isTerminated }
    let running = !applications.isEmpty
    let launched = applications.contains { $0.isFinishedLaunching }
    let target = NSAppleEventDescriptor(bundleIdentifier: identifier)
    let status = withExtendedLifetime(target) {
        AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false)
    }
    let permission: String
    switch status {
    case 0: permission = "allowed"
    case -1743: permission = "denied"
    case -1744: permission = "requires user consent"
    case -600: permission = "target not reachable"
    default: permission = "unknown"
    }
    print("\(identifier): running=\(running), finishedLaunching=\(launched), permission=\(permission) (\(status))")
}
