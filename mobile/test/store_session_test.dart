import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:il_mio_cioccolato/services/store_session.dart';

class MemoryVault implements SessionVault {
  Map<String, dynamic>? value;
  @override
  Future<Map<String, dynamic>?> read() async =>
      value == null ? null : Map<String, dynamic>.from(value!);
  @override
  Future<void> write(Map<String, dynamic> v) async {
    value = Map<String, dynamic>.from(v);
  }

  @override
  Future<void> clear() async {
    value = null;
  }
}

class MemoryCache implements MenuCache {
  final data = <String, Map<String, dynamic>>{};
  @override
  Future<Map<String, dynamic>?> read(String org, String store) async =>
      data['$org:$store'];
  @override
  Future<void> write(String org, String store, Map<String, dynamic> v) async {
    data['$org:$store'] = jsonDecode(jsonEncode(v));
  }

  @override
  Future<void> clear(String org, String store) async {
    data.remove('$org:$store');
  }
}

Map<String, dynamic> envelope(String store,
        {List<String> brands = const ['brand-a'], int revision = 1}) =>
    {
      'schemaVersion': 2,
      'store': {'id': store, 'orgId': 'owner', 'name': store},
      'revision': revision,
      'brands': [
        for (final id in brands)
          {
            'id': id,
            'name': id,
            'currency': 'AED',
            'menuVersion': revision,
            'categories': []
          }
      ]
    };
http.Response response(Object value,
        {int status = 200, Map<String, String>? headers}) =>
    http.Response(jsonEncode(value), status, headers: headers ?? {});
Map<String, dynamic> loginResponse(String store) => {
      'accessToken': 'access-$store',
      'refreshToken': 'refresh-$store',
      'store': {'id': store, 'orgId': 'owner', 'name': store}
    };

void main() {
  test('offline restart stays bound to the store and expires after 90 days',
      () async {
    final vault = MemoryVault(), cache = MemoryCache();
    var time = DateTime.utc(2026, 10, 30);
    final online = StoreSessionController(
        vault: vault,
        cache: cache,
        now: () => time,
        client: MockClient((req) async => req.url.path.endsWith('/login')
            ? response(loginResponse('downtown'))
            : response(envelope('downtown'))));
    await online.login('downtown', 'password');
    expect(online.menu?['store']['id'], 'downtown');
    online.dispose();
    time = time.add(const Duration(days: 89, hours: 23));
    StoreSessionController offline() => StoreSessionController(
        vault: vault,
        cache: cache,
        now: () => time,
        client: MockClient((_) async => throw http.ClientException('Offline')));
    final resumed = offline();
    await resumed.restore();
    expect(resumed.offline, isTrue);
    expect(resumed.menu?['store']['id'], 'downtown');
    resumed.dispose();
    time = time.add(const Duration(hours: 2));
    final expired = offline();
    await expired.restore();
    expect(expired.menu, isNull);
    expect(expired.error, contains('internet'));
    expired.dispose();
  });
  test(
      '401 refreshes once, rotates secure credentials and retries with the new access token',
      () async {
    final vault = MemoryVault(), cache = MemoryCache();
    var reads = 0, refreshes = 0;
    final controller = StoreSessionController(
        vault: vault,
        cache: cache,
        client: MockClient((req) async {
          if (req.url.path.endsWith('/login')) {
            return response(loginResponse('downtown'));
          }
          if (req.url.path.endsWith('/refresh')) {
            refreshes++;
            expect(jsonDecode(req.body)['refreshToken'], 'refresh-downtown');
            return response(
                {'accessToken': 'new-access', 'refreshToken': 'new-refresh'});
          }
          expect(req.url.query, isEmpty);
          reads++;
          if (reads == 1) return response({'error': 'Expired'}, status: 401);
          expect(req.headers['Authorization'], 'Bearer new-access');
          return response(envelope('downtown'));
        }));
    await controller.login('downtown', 'password');
    expect(reads, 2);
    expect(refreshes, 1);
    expect(vault.value?['refreshToken'], 'new-refresh');
    expect(controller.menu, isNotNull);
    controller.dispose();
  });
  test('one-time store QR creates an authenticated session without a password',
      () async {
    final qrToken = List.filled(43, 'A').join();
    final controller = StoreSessionController(
        vault: MemoryVault(),
        cache: MemoryCache(),
        client: MockClient((req) async {
          if (req.url.path.endsWith('/qr-login')) {
            final body = jsonDecode(req.body);
            expect(body['loginCode'], 'cbw-alforsan');
            expect(body['token'], qrToken);
            expect(body.containsKey('password'), isFalse);
            return response(loginResponse('cbw-alforsan'));
          }
          if (req.method == 'GET') return response(envelope('cbw-alforsan'));
          throw StateError('Unexpected QR login request: ${req.url.path}');
        }));

    await controller.loginWithQr(
      'cbw-alforsan',
      qrToken,
    );

    expect(controller.signedIn, isTrue);
    expect(controller.storeId, 'cbw-alforsan');
    expect(controller.error, isNull);
    controller.dispose();
  });
  test('password confirmation verifies credentials without creating a session',
      () async {
    final requests = <String>[];
    final controller = StoreSessionController(
        vault: MemoryVault(),
        cache: MemoryCache(),
        client: MockClient((req) async {
          requests.add(req.url.path);
          if (req.url.path.endsWith('/verify-password')) {
            expect(jsonDecode(req.body)['loginCode'], 'downtown');
            expect(jsonDecode(req.body)['password'], 'correct-password');
            return http.Response('', 204);
          }
          if (req.method == 'GET') return response(envelope('downtown'));
          if (req.url.path.endsWith('/login')) {
            expect(jsonDecode(req.body)['loginCode'], 'downtown');
            expect(jsonDecode(req.body)['password'], 'correct-password');
            return response(loginResponse('downtown'));
          }
          expect(req.url.path.endsWith('/logout'), isTrue);
          expect(req.headers['Authorization'], 'Bearer access-downtown');
          return http.Response('', 204);
        }));
    await controller.login('downtown', 'correct-password');
    final requestsAfterSignIn = requests.length;

    await controller.verifyPassword('downtown', 'correct-password');

    expect(requests.skip(requestsAfterSignIn),
        ['/api/auth/store/verify-password']);
    expect(controller.signedIn, isTrue);
    controller.dispose();
  });
  test(
      'logout/store switch rejects a late response and cannot repopulate the previous cache',
      () async {
    final vault = MemoryVault(),
        cache = MemoryCache(),
        pending = Completer<http.Response>(),
        started = Completer<void>();
    final controller = StoreSessionController(
        vault: vault,
        cache: cache,
        client: MockClient((req) async {
          if (req.url.path.endsWith('/login')) {
            return response(loginResponse(jsonDecode(req.body)['loginCode']));
          }
          if (req.headers['Authorization'] == 'Bearer access-store-a') {
            started.complete();
            return pending.future;
          }
          return response(envelope('store-b'));
        }));
    final first = controller.login('store-a', 'password');
    await started.future;
    await controller.logout(remote: false);
    await controller.login('store-b', 'password');
    pending.complete(response(envelope('store-a')));
    await first;
    expect(controller.storeId, 'store-b');
    expect(controller.menu?['store']['id'], 'store-b');
    expect(vault.value?['storeId'], 'store-b');
    expect(cache.data.containsKey('owner:store-a'), isFalse);
    controller.dispose();
  });
  test('explicit refresh rejection removes identity and protected cache',
      () async {
    final vault = MemoryVault(), cache = MemoryCache();
    vault.value = {
      'storeId': 'downtown',
      'orgId': 'owner',
      'storeName': 'Downtown',
      'refreshToken': 'old-refresh',
      'authorizedAt': DateTime.now().toUtc().toIso8601String()
    };
    cache.data['owner:downtown'] = envelope('downtown');
    final controller = StoreSessionController(
        vault: vault,
        cache: cache,
        client: MockClient(
            (_) async => response({'error': 'Revoked'}, status: 401)));
    await controller.restore();
    expect(controller.signedIn, isFalse);
    expect(controller.menu, isNull);
    expect(vault.value, isNull);
    expect(cache.data, isEmpty);
    controller.dispose();
  });
  test(
      'online assignment removal replaces the cached brand list and sends the store ETag',
      () async {
    final cache = MemoryCache();
    var reads = 0;
    final controller = StoreSessionController(
        vault: MemoryVault(),
        cache: cache,
        client: MockClient((req) async {
          if (req.url.path.endsWith('/login')) {
            return response(loginResponse('downtown'));
          }
          reads++;
          if (reads == 1) {
            return response(
                envelope('downtown', brands: ['brand-a', 'brand-b']),
                headers: {'etag': '"store:downtown:rev:1"'});
          }
          expect(req.headers['If-None-Match'], '"store:downtown:rev:1"');
          return response(envelope('downtown', revision: 2),
              headers: {'etag': '"store:downtown:rev:2"'});
        }));
    await controller.login('downtown', 'password');
    expect((controller.menu?['brands'] as List).length, 2);
    await controller.sync();
    expect((cache.data['owner:downtown']?['brands'] as List).length, 1);
    controller.dispose();
  });
  test('a cached menu from a different physical store is never displayed',
      () async {
    final vault = MemoryVault(), cache = MemoryCache();
    vault.value = {
      'storeId': 'downtown',
      'orgId': 'owner',
      'refreshToken': 'old',
      'authorizedAt': DateTime.now().toUtc().toIso8601String()
    };
    cache.data['owner:downtown'] = envelope('marina');
    final controller = StoreSessionController(
        vault: vault,
        cache: cache,
        client: MockClient((_) async => throw http.ClientException('Offline')));
    await controller.restore();
    expect(controller.menu, isNull);
    controller.dispose();
  });
}
