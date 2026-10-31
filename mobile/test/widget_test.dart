import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:il_mio_cioccolato/models/product.dart';
import 'package:il_mio_cioccolato/screens/gallery_screen.dart';
import 'package:il_mio_cioccolato/services/api_service.dart';
import 'package:il_mio_cioccolato/widgets/product_card.dart';

class GalleryApi extends ApiService {
  @override
  Future<List<Map<String, dynamic>>> fetchCategories() async => [
        {'id': 'pastries', 'name': 'Pastries'},
        {'id': 'drinks', 'name': 'Drinks'},
        {'id': 'empty', 'name': 'Empty'},
      ];

  @override
  Future<List<Product>> fetchAvailableProducts() async => [
        for (var i = 0; i < 3; i++)
          Product(
            id: '$i',
            title: ['Croissant', 'Latte', 'Cake'][i],
            category: i == 1 ? 'drinks' : 'pastries',
            image: 'https://example.com/product-$i.jpg',
            description: [
              'Buttery pastry',
              'Freshly brewed coffee',
              'Chocolate cake'
            ][i],
            ingredients: ['Flour, butter', 'Coffee, milk', 'Cocoa, eggs'][i],
            price: 'AED ${20 + i}',
            available: true,
            sizes: i == 1
                ? [
                    const ProductSize(
                      id: 'small',
                      name: 'Small',
                      price: 'AED 18.00',
                      amount: 18,
                      available: true,
                    ),
                    const ProductSize(
                      id: 'large',
                      name: 'Large',
                      price: 'AED 24.00',
                      amount: 24,
                      available: false,
                    ),
                  ]
                : const [],
            addOnGroups: i == 1
                ? [
                    const ProductAddOnGroup(
                      id: 'milk',
                      name: 'Milk options',
                      selection: 'single',
                      options: [
                        ProductAddOn(
                          id: 'oat',
                          name: 'Oat milk',
                          price: 'AED 2.00',
                          available: false,
                        ),
                      ],
                    ),
                  ]
                : const [],
            createdAt: DateTime(2026),
            updatedAt: DateTime(2026),
          ),
      ];
}

Future<void> loadGallery(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1200, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester
      .pumpWidget(MaterialApp(home: GalleryScreen(apiService: GalleryApi())));
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
}

Future<void> openMenu(WidgetTester tester) async {
  await tester.tapAt(const Offset(600, 300));
  await tester.pump();
}

Future<void> disposeGallery(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('sized product card never falls back to the base price',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: SizedBox(
        width: 300,
        height: 320,
        child: ProductCard(
          product: Product(
            id: 'sized-coffee',
            title: 'Coffee',
            category: 'drinks',
            image: 'https://example.com/coffee.jpg',
            description: 'Coffee',
            ingredients: 'Coffee beans',
            price: 'AED 21.00',
            available: true,
            sizes: const [
              ProductSize(
                id: 'large',
                name: 'Large',
                price: 'AED 18.00',
                amount: 18,
                available: false,
              ),
            ],
            createdAt: DateTime(2026),
            updatedAt: DateTime(2026),
          ),
        ),
      ),
    ));

    expect(find.text('Unavailable'), findsOneWidget);
    expect(find.text('\u20C3\u00A021.00'), findsNothing);
  });

  testWidgets('idle slideshow fills the screen without header or categories',
      (tester) async {
    await loadGallery(tester);
    expect(find.text('Pastries'), findsNothing);
    expect(find.text('Drinks'), findsNothing);
    expect(find.text('Menu'), findsNothing);
    expect(find.text('Croissant'), findsOneWidget);
    expect(find.text('Description'), findsNothing);
    expect(find.text('Ingredients'), findsNothing);
    expect(find.byTooltip('Next product'), findsNothing);
    final slide = tester.getRect(find.byKey(const ValueKey('0')));
    expect(slide, const Rect.fromLTWH(0, 0, 1200, 800));
    await tester.pump(const Duration(seconds: 5));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Latte'), findsOneWidget);
    expect(find.text('From '), findsNothing);
    expect(find.text('\u20C3\u00A018.00'), findsNothing);
    expect(find.text('\u20C3\u00A021.00'), findsNothing);
    await disposeGallery(tester);
  });

  testWidgets(
      'product opens full screen, swipes both ways, resumes after inactivity',
      (tester) async {
    await loadGallery(tester);
    await openMenu(tester);
    // Category filters remain available in the menu; badges are gone from cards.
    expect(find.text('pastries'), findsNothing);
    expect(find.text('drinks'), findsNothing);
    await tester.tap(find.byType(ProductCard).at(1));
    await tester.pump();
    final viewer = find.byKey(const ValueKey('product-viewer'));
    expect(tester.getRect(viewer), const Rect.fromLTWH(0, 0, 1200, 800));
    expect(find.text('Pastries'), findsNothing);
    expect(find.text('Drinks'), findsNothing);
    expect(find.text('Latte').hitTestable(), findsOneWidget);
    expect(find.text('Freshly brewed coffee').hitTestable(), findsOneWidget);
    expect(find.text('Coffee, milk').hitTestable(), findsOneWidget);
    expect(find.text('Sizes & prices').hitTestable(), findsOneWidget);
    expect(find.text('Small').hitTestable(), findsOneWidget);
    expect(find.text('Large').hitTestable(), findsOneWidget);
    expect(find.text('Milk options').hitTestable(), findsOneWidget);
    expect(find.text('Oat milk').hitTestable(), findsOneWidget);
    expect(find.text('\u20C3\u00A018.00').hitTestable(), findsOneWidget);
    expect(find.text('\u20C3\u00A024.00').hitTestable(), findsOneWidget);
    expect(find.text('Description'), findsOneWidget);
    expect(find.text('Ingredients'), findsOneWidget);
    expect(find.byTooltip('Previous product'), findsOneWidget);
    expect(find.byTooltip('Next product'), findsOneWidget);
    await tester.drag(viewer, const Offset(-1100, 0));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Cake').hitTestable(), findsOneWidget);
    expect(find.text('Cocoa, eggs').hitTestable(), findsOneWidget);
    await tester.pump(const Duration(seconds: 30));
    await tester.drag(viewer, const Offset(1100, 0));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Latte').hitTestable(), findsOneWidget);
    await tester.pump(const Duration(seconds: 30));
    expect(viewer, findsOneWidget); // A swipe restarts the idle countdown.
    await tester.pump(const Duration(seconds: 15));
    expect(viewer, findsNothing);
    expect(find.text('Tap anywhere to browse the menu'), findsOneWidget);
    expect(find.text('Pastries'), findsNothing);
    await tester.pump(const Duration(seconds: 5));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Latte'), findsOneWidget);
    await disposeGallery(tester);
  });

  testWidgets(
      'viewer returns to category menu and empty categories recover on idle',
      (tester) async {
    await loadGallery(tester);
    await openMenu(tester);
    await tester.tap(find.text('Pastries'));
    await tester.pump();
    expect(find.byType(ProductCard), findsNWidgets(2));
    await tester.tap(find.byType(ProductCard).first);
    await tester.pump();
    await tester.tap(find.text('Back to menu'));
    await tester.pump();
    expect(find.byType(ProductCard), findsNWidgets(2));
    await tester.tap(find.text('Empty'));
    await tester.pump();
    expect(find.byType(ProductCard), findsNothing);
    await tester.pump(const Duration(seconds: 45));
    await tester.pump();
    expect(find.text('Croissant'), findsOneWidget);
    expect(find.text('Empty'), findsNothing);
    await disposeGallery(tester);
  });

  testWidgets(
      'subtle arrow buttons navigate product details and stop at list ends',
      (tester) async {
    await loadGallery(tester);
    await openMenu(tester);
    await tester.tap(find.byType(ProductCard).first);
    await tester.pump();
    final previous =
        find.widgetWithIcon(IconButton, Icons.chevron_left_rounded);
    final next = find.widgetWithIcon(IconButton, Icons.chevron_right_rounded);
    expect(tester.widget<IconButton>(previous).onPressed, isNull);
    await tester.tap(next);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Latte').hitTestable(), findsOneWidget);
    expect(find.text('Coffee, milk').hitTestable(), findsOneWidget);
    await tester.tap(next);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Cake').hitTestable(), findsOneWidget);
    expect(tester.widget<IconButton>(next).onPressed, isNull);
    await tester.tap(previous);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Latte').hitTestable(), findsOneWidget);
    await disposeGallery(tester);
  });
}
