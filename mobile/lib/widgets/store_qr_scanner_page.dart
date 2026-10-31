import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/store_login_qr.dart';

class StoreQrScannerPage extends StatefulWidget {
  const StoreQrScannerPage({super.key});

  @override
  State<StoreQrScannerPage> createState() => _StoreQrScannerPageState();
}

class _StoreQrScannerPageState extends State<StoreQrScannerPage>
    with WidgetsBindingObserver {
  late final MobileScannerController _controller;
  String? _lastInvalidValue;
  String? _cameraError;
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = MobileScannerController(autoStart: false);
    WidgetsBinding.instance.addPostFrameCallback((_) => _startScanner());
  }

  Future<void> _startScanner() async {
    if (!mounted || _starting) return;
    setState(() {
      _starting = true;
      _cameraError = null;
    });
    try {
      await _controller.start();
    } on MobileScannerException catch (error) {
      if (mounted) {
        setState(() {
          _cameraError = error.errorDetails?.message ??
              'The camera could not be started. Check camera access and try again.';
        });
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _startScanner());
    } else if (state == AppLifecycleState.paused) {
      _controller.stop();
    }
  }

  void _onDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final result = StoreLoginQr.parse(barcode.rawValue);
      if (result != null) {
        _controller.stop();
        Navigator.of(context).pop(result);
        return;
      }
      final value = barcode.rawValue;
      if (value != null && value != _lastInvalidValue) {
        _lastInvalidValue = value;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(content: Text('Invalid Store Login QR.')),
          );
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scan store login QR'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth.clamp(280.0, 720.0);
              final height = constraints.maxHeight.clamp(280.0, 520.0);
              final frameWidth = (width - 80).clamp(220.0, 560.0);
              final frameHeight = (height - 160).clamp(180.0, 360.0);
              return Align(
                alignment: Alignment.center,
                child: SizedBox(
                  width: width,
                  height: height,
                  child: ClipRect(
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        MobileScanner(
                          controller: _controller,
                          fit: BoxFit.cover,
                          onDetect: _onDetect,
                          errorBuilder: (context, error) => _CameraMessage(
                            message: error.errorCode ==
                                    MobileScannerErrorCode.permissionDenied
                                ? 'Camera permission is needed to scan a store login QR.'
                                : 'The camera could not be started. Check camera access and try again.',
                            onRetry: _startScanner,
                          ),
                        ),
                        IgnorePointer(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                width: frameWidth,
                                height: frameHeight,
                                decoration: BoxDecoration(
                                  border:
                                      Border.all(color: Colors.white, width: 3),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                              ),
                              const SizedBox(height: 24),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 18, vertical: 10),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.65),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: const Text(
                                  'Align the store QR code within the frame.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      color: Colors.white, fontSize: 16),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_cameraError != null || _starting)
                          _CameraMessage(
                            message:
                                _starting ? 'Starting camera…' : _cameraError!,
                            onRetry: _startScanner,
                          ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _CameraMessage extends StatelessWidget {
  const _CameraMessage({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        margin: const EdgeInsets.all(32),
        padding: const EdgeInsets.all(24),
        color: Colors.black.withValues(alpha: 0.8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 18)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: onRetry,
              child: const Text('Retry camera'),
            ),
          ],
        ),
      ),
    );
  }
}
