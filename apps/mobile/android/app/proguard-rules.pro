# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Every release ships its R8 mapping.txt with the AAB (Play Console and Crashlytics deobfuscate with it).
# Keep file names and line numbers in stack traces, and custom exception names, for readable reports.
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception


# react-native-device-info reaches the Play Install Referrer client by reflection.
-keep class com.android.installreferrer.api.** { *; }

# Expo creates native views by reflection with (Context, AppContext). expo-modules-core keeps that
# constructor only on ExpoView subclasses; a module view extending another Android View (expo-gl's
# GLView extends TextureView) loses it under R8 and the screen crashes in release only with
# "Didn't find a correct constructor". Harmless when no such view is used; keep it for the day one is.
-keepclassmembers class * extends android.view.View {
  public <init>(android.content.Context, expo.modules.kotlin.AppContext);
}
