// LaunchScreen.storyboard: the BootSplashBackground colour and the centred
// BootSplashLogo image, no labels. Light and dark come from the asset catalog's
// appearances; the storyboard itself is static. Template ids are kept so Xcode sees the same scene.
import { SPLASH_CONSTANTS } from './splashConstants';

/** #rrggbb to channel fractions, printed as Interface Builder writes them. */
function channels(hex: string): { red: string; green: string; blue: string } {
  const c = (i: number): string => (parseInt(hex.slice(i, i + 2), 16) / 255).toString();
  return { red: c(1), green: c(3), blue: c(5) };
}

const FRAME = { width: 375, height: 667 };

export function launchStoryboard(): string {
  const w = SPLASH_CONSTANTS.logoWidthDp;
  const { red, green, blue } = channels(SPLASH_CONSTANTS.background.light);
  const x = (FRAME.width - w) / 2;
  const y = (FRAME.height - w) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="15702" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="15704"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="${FRAME.width}" height="${FRAME.height}"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="BootSplashLogo" translatesAutoresizingMaskIntoConstraints="NO" id="Lgo-Im-001">
                                <rect key="frame" x="${x}" y="${y}" width="${w}" height="${w}"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="${w}" id="Lgo-Wd-001"/>
                                    <constraint firstAttribute="height" constant="${w}" id="Lgo-Ht-001"/>
                                </constraints>
                            </imageView>
                        </subviews>
                        <color key="backgroundColor" name="BootSplashBackground"/>
                        <constraints>
                            <constraint firstItem="Lgo-Im-001" firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX" id="Lgo-Cx-001"/>
                            <constraint firstItem="Lgo-Im-001" firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY" id="Lgo-Cy-001"/>
                        </constraints>
                        <viewLayoutGuide key="safeArea" id="Bcu-3y-fUS"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="52.173913043478265" y="375"/>
        </scene>
    </scenes>
    <resources>
        <image name="BootSplashLogo" width="${w}" height="${w}"/>
        <namedColor name="BootSplashBackground">
            <color red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
        </namedColor>
    </resources>
</document>
`;
}
