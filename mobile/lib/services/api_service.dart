import '../models/product.dart';

class ApiService {
  Future<List<Product>> fetchAvailableProducts() async =>
      throw StateError('An authenticated menu is required.');
  Future<List<Map<String, dynamic>>> fetchCategories() async =>
      throw StateError('An authenticated menu is required.');
}

class PublishedBrandApi extends ApiService {
  final Map<String, dynamic> brand;
  PublishedBrandApi(this.brand);
  Map<String, dynamic> get presentation =>
      Map<String, dynamic>.from((brand['presentation'] as Map?) ?? const {});
  @override
  Future<List<Map<String, dynamic>>> fetchCategories() async =>
      List<Map<String, dynamic>>.from((brand['categories'] as List).map((c) => {
            'id': c['id'],
            'name': c['name'],
            'order': c['sortOrder'],
            'parentId': c['parentId']
          }));
  @override
  Future<List<Product>> fetchAvailableProducts() async =>
      (brand['categories'] as List)
          .expand((c) => (c['items'] as List).map((p) => Product.fromJson({
                '_id': p['id'],
                'title': p['name'],
                'category': c['id'],
                'image': p['imageUrl'],
                'description': p['description'],
                'ingredients': p['ingredients'],
                'price':
                    '${p['currency'] ?? brand['currency']} ${double.parse(p['priceAmount'].toString()).toStringAsFixed(2)}',
                'available': p['availability'] != 'soldout',
                'sizes': (p['sizes'] as List? ?? [])
                    .map((size) => {
                          ...Map<String, dynamic>.from(size as Map),
                          'price': _formattedPrice(size['priceAmount'],
                              p['currency'] ?? brand['currency']),
                          'amount':
                              double.parse(size['priceAmount'].toString()),
                        })
                    .toList(),
                'addOnGroups': (p['addOnGroups'] as List? ?? [])
                    .map((group) => {
                          ...Map<String, dynamic>.from(group as Map),
                          'options': (group['options'] as List? ?? [])
                              .map((option) => {
                                    ...Map<String, dynamic>.from(option as Map),
                                    'price': _formattedPrice(
                                        option['priceAmount'],
                                        p['currency'] ?? brand['currency']),
                                  })
                              .toList(),
                        })
                    .toList(),
                'createdAt': p['createdAt'],
                'updatedAt': p['updatedAt']
              })))
          .toList();

  static String _formattedPrice(dynamic amount, dynamic currency) =>
      '${currency ?? 'AED'} ${double.parse(amount.toString()).toStringAsFixed(2)}';
}
