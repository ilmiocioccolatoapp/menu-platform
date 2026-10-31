# Menu Platform - Digital Menu App

## Description
Flutter-based app for browsing digital menus across the Menu Platform.

## Features
- Swipeable product gallery with PageView
- Beautiful card-based UI with animations
- Cached network images for performance
- Loading and error states
- Category badges and product details
- Responsive design for all screen sizes

## Prerequisites
- Flutter SDK (>=3.0.0)
- Android Studio / Xcode
- Android device/emulator or iOS device/simulator

### Android SDK command-line tools (important)

If you plan to run the app on Android devices or emulators, ensure the Android SDK command-line
tools and build-tools are installed. Flutter requires `aapt` (part of Android build-tools)
to build and install the app. If `flutter run` fails with "Could not locate aapt" or
`flutter doctor` reports missing command-line tools, follow the steps below.

- Using Android Studio:
	- Open Android Studio → SDK Manager → SDK Tools tab.
	- Check and install **Android SDK Command-line Tools**, **Android SDK Build-Tools**,
		and **Android SDK Platform-Tools** for the Android API level you target (e.g. API 31).

- Using the command line (example):

```bash
# set this to your SDK path if different
export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
export PATH="$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools"

# install command-line tools, platform-tools, platforms and build-tools
# adjust android-31 / 33.0.2 to the API / build-tools version you need
sdkmanager --install "cmdline-tools;latest" "platform-tools" "platforms;android-31" "build-tools;33.0.2"
```

After installation, verify with:

```bash
flutter doctor -v
flutter devices
```

If you downloaded the command-line tools bundle manually, unzip it into
`$ANDROID_SDK_ROOT/cmdline-tools/` and place the folder as `latest` (or update
the PATH to point to the correct folder).

## Installation

1. Install dependencies:
```bash
flutter pub get
```

2. Configure the API endpoint at build time with `API_BASE_URL`:

- **Android Emulator**: `http://10.0.2.2:5001/api`
- **iOS Simulator**: `http://localhost:5001/api`
- **Physical Device**: `http://YOUR_COMPUTER_IP:5001/api`

For example, build against an isolated staging API with:

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://staging-api.example.com/api
```

Do not point a test APK at a Vercel Preview deployment protected by Vercel SSO. The app cannot complete that browser challenge. Do not embed Vercel bypass tokens or Supabase server keys in the APK.

## Running the App

### Development Mode
```bash
flutter run
```

### Build APK (Android)
```bash
flutter build apk --release
```

The APK will be located at: `build/app/outputs/flutter-apk/app-release.apk`

### Build for iOS
```bash
flutter build ios --release
```

## Project Structure
```
lib/
├── models/          # Data models
├── services/        # API services
├── screens/         # App screens
├── widgets/         # Reusable widgets
├── utils/           # Constants and utilities
└── main.dart        # App entry point
```

## Dependencies
- **http**: API requests
- **provider**: State management
- **cached_network_image**: Image caching
- **flutter_spinkit**: Loading animations

## API Configuration
Ensure the backend server is running before launching the app. The app fetches available products from:
```
GET /api/products/available
```

## Troubleshooting

### Connection Issues
- Verify backend is running on port 5001
- Check firewall settings
- Ensure correct IP address for physical devices
- For Android emulator, use `10.0.2.2` instead of `localhost`

### Build Issues
```bash
flutter clean
flutter pub get
flutter run
```

## Technologies Used
- Flutter 3.x
- Dart
- Material Design 3
- HTTP package for API calls
- Cached Network Images
