import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import '../utils/constants.dart';

abstract class SessionVault {
  Future<Map<String, dynamic>?> read();
  Future<void> write(Map<String, dynamic> value);
  Future<void> clear();
}

class SecureSessionVault implements SessionVault {
  final FlutterSecureStorage storage;
  SecureSessionVault({this.storage = const FlutterSecureStorage()});
  static const key = 'menu-platform-store-session-v2';
  @override
  Future<Map<String, dynamic>?> read() async {
    final value = await storage.read(key: key);
    return value == null ? null : Map<String, dynamic>.from(jsonDecode(value));
  }

  @override
  Future<void> write(Map<String, dynamic> value) =>
      storage.write(key: key, value: jsonEncode(value));
  @override
  Future<void> clear() => storage.delete(key: key);
}

abstract class MenuCache {
  Future<Map<String, dynamic>?> read(String orgId, String storeId);
  Future<void> write(String orgId, String storeId, Map<String, dynamic> value);
  Future<void> clear(String orgId, String storeId);
}

class FileMenuCache implements MenuCache {
  Future<File> file(String org, String store) async {
    final dir = await getApplicationSupportDirectory();
    final name = base64Url.encode(utf8.encode('$org:$store'));
    return File('${dir.path}/menu-$name.json');
  }

  @override
  Future<Map<String, dynamic>?> read(String orgId, String storeId) async {
    final f = await file(orgId, storeId);
    if (!await f.exists()) return null;
    try {
      return Map<String, dynamic>.from(jsonDecode(await f.readAsString()));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(
      String orgId, String storeId, Map<String, dynamic> value) async {
    final f = await file(orgId, storeId);
    final temp = File('${f.path}.tmp');
    await temp.writeAsString(jsonEncode(value), flush: true);
    await temp.rename(f.path);
  }

  @override
  Future<void> clear(String orgId, String storeId) async {
    final f = await file(orgId, storeId);
    for (final target in [f, File('${f.path}.tmp')]) {
      if (await target.exists()) await target.delete();
    }
  }
}

class StoreFailure implements Exception {
  final int status;
  final String message;
  final int? retryAfter;
  StoreFailure(this.status, this.message, [this.retryAfter]);
}

class StoreSessionController extends ChangeNotifier {
  final http.Client client;
  final SessionVault vault;
  final MenuCache cache;
  final DateTime Function() now;
  final String baseUrl;
  static const offlineWindow = Duration(days: 90);
  Map<String, dynamic>? _identity;
  Map<String, dynamic>? menu;
  String? _accessToken;
  String? _etag;
  String? error;
  bool busy = true, offline = false;
  int _generation = 0;
  bool _disposed = false;
  Future<void>? _syncing;
  Future<void> _writes = Future.value();
  StoreSessionController(
      {http.Client? client,
      SessionVault? vault,
      MenuCache? cache,
      DateTime Function()? now,
      String? baseUrl})
      : client = client ?? http.Client(),
        vault = vault ?? SecureSessionVault(),
        cache = cache ?? FileMenuCache(),
        now = now ?? DateTime.now,
        baseUrl = baseUrl ?? AppConstants.baseUrl;
  bool get signedIn => _identity != null;
  String? get storeId => _identity?['storeId'];
  String? get loginCode => _identity?['loginCode'] as String?;
  String get storeName => _identity?['storeName'] ?? 'Store';
  bool get _withinOfflineWindow {
    final value = DateTime.tryParse(_identity?['authorizedAt'] ?? '');
    if (value == null) return false;
    final age = now().toUtc().difference(value);
    return !age.isNegative && age <= offlineWindow;
  }

  bool _current(int generation) => !_disposed && generation == _generation;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  Future<void> _persist(int generation) {
    final identity =
        _identity == null ? null : Map<String, dynamic>.from(_identity!);
    final envelope = menu == null ? null : Map<String, dynamic>.from(menu!);
    _writes = _writes.catchError((_) {}).then((_) async {
      if (!_current(generation) || identity == null) return;
      await vault.write(identity);
      if (envelope != null && _current(generation)) {
        await cache.write(identity['orgId'], identity['storeId'], envelope);
      }
    });
    return _writes;
  }

  Future<void> restore() async {
    final generation = ++_generation;
    try {
      final saved = await vault.read();
      if (!_current(generation)) return;
      if (saved == null) {
        busy = false;
        _emit();
        return;
      }
      if (saved['storeId'] is! String ||
          saved['orgId'] is! String ||
          saved['refreshToken'] is! String) {
        await logout(remote: false);
        return;
      }
      _identity = saved;
      final cached = await cache.read(saved['orgId'], saved['storeId']);
      if (!_current(generation)) return;
      if (cached != null && _validEnvelope(cached) && _withinOfflineWindow) {
        menu = cached;
      }
      await sync();
    } catch (_) {
      if (_current(generation)) {
        await logout(remote: false);
        error = 'Sign in to load this store’s menu.';
      }
    } finally {
      if (_current(generation)) {
        busy = false;
        _emit();
      }
    }
  }

  bool _validEnvelope(Map<String, dynamic> envelope) =>
      envelope['schemaVersion'] == 2 &&
      envelope['store']?['id'] == _identity?['storeId'] &&
      envelope['store']?['orgId'] == _identity?['orgId'] &&
      envelope['brands'] is List;
  Future<http.Response> _post(String path, Map<String, dynamic> body) => client
      .post(Uri.parse('$baseUrl$path'),
          headers: {'Content-Type': 'application/json'}, body: jsonEncode(body))
      .timeout(const Duration(seconds: 20));
  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> value = {};
    try {
      value = Map<String, dynamic>.from(jsonDecode(response.body));
    } catch (_) {}
    if (response.statusCode >= 400) {
      throw StoreFailure(
          response.statusCode,
          value['detail'] ?? value['error'] ?? 'Request failed.',
          int.tryParse(response.headers['retry-after'] ?? ''));
    }
    return value;
  }

  Future<void> login(String loginCode, String password) async {
    await _loginWith(
      '/auth/store/login',
      {
        'loginCode': loginCode.trim(),
        'password': password,
        'deviceLabel': 'Store tablet'
      },
      loginCode.trim(),
      qrLogin: false,
    );
  }

  Future<void> loginWithQr(String loginCode, String token) async {
    await _loginWith(
      '/auth/store/qr-login',
      {
        'loginCode': loginCode,
        'token': token,
      },
      loginCode,
      qrLogin: true,
    );
  }

  Future<void> _loginWith(
      String path, Map<String, dynamic> body, String loginCode,
      {required bool qrLogin}) async {
    await logout(remote: false);
    final generation = _generation;
    busy = true;
    error = null;
    _emit();
    try {
      final data = _decode(await _post(path, body));
      if (!_current(generation)) return;
      final store = Map<String, dynamic>.from(data['store']);
      _identity = {
        'storeId': store['id'],
        'orgId': store['orgId'],
        'storeName': store['name'],
        'loginCode': loginCode,
        'refreshToken': data['refreshToken']
      };
      _accessToken = data['accessToken'];
      await _persist(generation);
      await sync();
    } on StoreFailure catch (e) {
      if (_current(generation)) {
        error = e.status == 429
            ? 'Too many attempts. Try again in ${((e.retryAfter ?? 900) / 60).ceil()} min.'
            : e.status == 401
                ? qrLogin
                    ? 'Invalid Store Login QR.'
                    : 'Invalid store ID or password'
                : e.message;
      }
    } catch (_) {
      if (_current(generation)) {
        error =
            'Could not connect. Check the internet connection and try again.';
      }
    } finally {
      if (_current(generation)) {
        busy = false;
        _emit();
      }
    }
  }

  Future<void> verifyPassword(String loginCode, String password) async {
    _decode(await _post('/auth/store/verify-password', {
      'loginCode': loginCode.trim(),
      'password': password,
    }));
  }

  Future<void> _refresh(int generation) async {
    final refreshToken = _identity?['refreshToken'];
    if (refreshToken == null) throw StoreFailure(401, 'Sign in is required.');
    final data = _decode(
        await _post('/auth/store/refresh', {'refreshToken': refreshToken}));
    if (!_current(generation)) return;
    _accessToken = data['accessToken'];
    _identity = {..._identity!, 'refreshToken': data['refreshToken']};
    await _persist(generation);
  }

  Future<void> sync() {
    if (_syncing != null) return _syncing!;
    final future = _sync();
    _syncing = future;
    future.whenComplete(() {
      if (identical(_syncing, future)) _syncing = null;
    });
    return future;
  }

  Future<void> _sync() async {
    if (_identity == null) return;
    final generation = _generation;
    try {
      if (_accessToken == null) await _refresh(generation);
      if (!_current(generation)) return;
      Future<http.Response> read() =>
          client.get(Uri.parse('$baseUrl/menu'), headers: {
            'Authorization': 'Bearer $_accessToken',
            if (_etag != null && menu != null) 'If-None-Match': _etag!
          }).timeout(const Duration(seconds: 20));
      var response = await read();
      if (response.statusCode == 401) {
        await _refresh(generation);
        if (!_current(generation)) return;
        response = await read();
      }
      if (!_current(generation)) return;
      if (response.statusCode == 304) {
        if (menu == null) throw StoreFailure(502, 'No cached menu.');
      } else {
        final envelope = _decode(response);
        if (!_validEnvelope(envelope)) {
          throw StoreFailure(401, 'This menu belongs to another store.');
        }
        menu = envelope;
        _etag = response.headers['etag'];
      }
      _identity = {
        ..._identity!,
        'authorizedAt': now().toUtc().toIso8601String()
      };
      offline = false;
      error = null;
      await _persist(generation);
    } on StoreFailure catch (e) {
      if (!_current(generation)) return;
      if (e.status == 401 || e.status == 403) {
        await logout(remote: false);
        error = 'Your store session ended. Sign in again.';
      } else {
        offline = true;
        error = 'Could not sync the menu.';
        if (!_withinOfflineWindow) {
          menu = null;
          error =
              'Offline access expired. Connect to the internet to continue.';
        }
      }
    } catch (_) {
      if (!_current(generation)) return;
      offline = true;
      if (!_withinOfflineWindow) {
        menu = null;
        error = 'Connect to the internet to load this store’s menu.';
      }
    } finally {
      if (_current(generation)) _emit();
    }
  }

  Future<void> logout({bool remote = true}) async {
    final old = _identity, token = _accessToken;
    ++_generation;
    _identity = null;
    _accessToken = null;
    _etag = null;
    menu = null;
    error = null;
    offline = false;
    busy = false;
    _syncing = null;
    _emit();
    _writes = _writes.catchError((_) {}).then((_) async {
      await vault.clear();
      if (old != null) await cache.clear(old['orgId'], old['storeId']);
    });
    await _writes;
    if (remote && token != null) {
      try {
        await client.post(Uri.parse('$baseUrl/auth/store/logout'), headers: {
          'Authorization': 'Bearer $token'
        }).timeout(const Duration(seconds: 10));
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    client.close();
    super.dispose();
  }
}
