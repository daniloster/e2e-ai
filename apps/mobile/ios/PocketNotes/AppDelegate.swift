internal import Expo
import FirebaseCore
import React
import ReactAppDependencyProvider
import RNBootSplash

// Expo SDK 58 bare template (taken from spikes/render-r3f), adapted: the module name matches
// index.js (AppRegistry "PocketNotes"), Firebase is configured first, and the launch storyboard
// stays over the root view until JS hides it (react-native-bootsplash).
@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  let reactNativeFactoryModuleName = "PocketNotes"

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Firebase first: RNFirebase's native modules expect the default app before React Native loads
    // them. Collection stays off until the user consents (firebase.json, src/services/analytics.ts).
    FirebaseApp.configure()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // SceneDelegate creates the window and starts React Native (scene life cycle, iOS 27 SDK).
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func customize(_ rootView: UIView) {
    super.customize(rootView)
    RNBootSplash.initWithStoryboard("LaunchScreen", rootView: rootView)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let settings = RCTBundleURLProvider.sharedSettings()
    settings.jsLocation = Self.devServerLocation(current: settings.jsLocation)
    return settings.jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

#if DEBUG
  /// This app's Metro port. Every local React Native project has its own port (registry in
  /// ~/.claude/CLAUDE.md, "Metro ports"); React Native's prebuilt iOS core would otherwise use 8081.
  private static let metroPort = "8093"

  /// Where Debug builds load JS from: a location chosen in the dev menu on another port is kept;
  /// otherwise the Mac's address from ip.txt (a device) or localhost (the simulator), on this app's port.
  private static func devServerLocation(current: String?) -> String {
    if let current, !current.isEmpty, !current.hasSuffix(":\(metroPort)") { return current }
    let ip = Bundle.main.path(forResource: "ip", ofType: "txt")
      .flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return "\(ip?.isEmpty == false ? ip! : "localhost"):\(metroPort)"
  }
#endif
}
