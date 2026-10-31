import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../utils/constants.dart';
import '../utils/image_utils.dart';
import '../widgets/product_card.dart';
import '../widgets/product_details_page.dart';

class GalleryScreen extends StatefulWidget {
  const GalleryScreen({
    super.key,
    this.apiService,
    this.brandName = 'Menu',
    this.headerLeadingAction,
    this.headerTrailingAction,
  });

  final String brandName;

  final ApiService? apiService;
  final Widget? headerLeadingAction;
  final Widget? headerTrailingAction;

  @override
  State<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends State<GalleryScreen> {
  late final ApiService _apiService = widget.apiService ?? ApiService();
  Timer? _autoAdvanceTimer;
  Timer? _idleTimer;

  /// true = interactive menu grid; false = attract mode (auto slideshow)
  bool _menuMode = false;
  bool _viewingProduct = false;
  PageController? _productPageController;

  List<Product> _allProducts = [];
  List<Product> _filteredProducts = [];
  List<Map<String, dynamic>> _categories = [];
  bool _isLoading = true;
  String? _errorMessage;
  int _currentPage = 0;
  String _selectedCategory = 'all';

  /// How long without touch before returning to attract mode
  static const Duration _idleTimeout = Duration(seconds: 45);

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _autoAdvanceTimer?.cancel();
    _idleTimer?.cancel();
    _productPageController?.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final categories = await _apiService.fetchCategories();
      final products = await _apiService.fetchAvailableProducts();

      if (mounted) {
        setState(() {
          _categories = [
            {'id': 'all', 'name': 'All Items'},
            ...categories,
          ];
          _allProducts = products;
          _filteredProducts = products;
          _currentPage = 0;
          _selectedCategory = 'all';
          _isLoading = false;
        });
        if (_menuMode) {
          _resetIdleTimer();
        } else {
          _startAttractMode();
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceAll('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _loadProducts() async {
    await _loadData();
  }

  /// Full-screen slideshow: continuously cycles product image + name + price
  void _startAttractMode() {
    _autoAdvanceTimer?.cancel();
    _idleTimer?.cancel();

    if (_menuMode) return;
    if (_filteredProducts.isEmpty) return;

    _autoAdvanceTimer = Timer.periodic(AppConstants.autoAdvanceDuration, (
      timer,
    ) {
      if (!mounted || _menuMode || _filteredProducts.isEmpty) return;
      setState(() {
        _currentPage = (_currentPage + 1) % _filteredProducts.length;
      });
    });
  }

  void _enterMenuMode() {
    if (_menuMode) {
      _resetIdleTimer();
      return;
    }
    setState(() {
      _menuMode = true;
    });
    _autoAdvanceTimer?.cancel();
    _resetIdleTimer();
  }

  void _exitMenuMode() {
    if (!_menuMode) return;
    setState(() {
      _menuMode = false;
      _viewingProduct = false;
      _selectedCategory = 'all';
      _filteredProducts = _allProducts;
      _currentPage = 0;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startAttractMode();
    });
  }

  void _resetIdleTimer() {
    _idleTimer?.cancel();
    if (!_menuMode) return;
    _idleTimer = Timer(_idleTimeout, () {
      if (mounted) _exitMenuMode();
    });
  }

  void _onUserInteraction([_]) {
    if (_menuMode) {
      _resetIdleTimer();
    }
  }

  void _openProduct(int index) {
    _productPageController?.dispose();
    _productPageController = PageController(initialPage: index);
    setState(() {
      _currentPage = index;
      _viewingProduct = true;
    });
    _resetIdleTimer();
  }

  void _closeProduct() {
    setState(() => _viewingProduct = false);
    _resetIdleTimer();
  }

  void _changeProduct(int direction) {
    final nextPage = _currentPage + direction;
    if (nextPage < 0 || nextPage >= _filteredProducts.length) return;
    _resetIdleTimer();
    _productPageController?.animateToPage(
      nextPage,
      duration: AppConstants.pageTransitionDuration,
      curve: Curves.easeInOut,
    );
  }

  void _filterByCategory(String categoryId) {
    _onUserInteraction();
    setState(() {
      _selectedCategory = categoryId;
      if (categoryId == 'all') {
        _filteredProducts = _allProducts;
      } else {
        _filteredProducts = _allProducts
            .where(
              (product) =>
                  product.category.toLowerCase() == categoryId.toLowerCase(),
            )
            .toList();
      }
      _currentPage = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final isTablet = screenWidth >= 600;

    return PopScope(
      canPop: !_menuMode,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_viewingProduct) {
          _closeProduct();
        } else {
          _exitMenuMode();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(AppConstants.backgroundColorValue),
        body: _isLoading
            ? _buildLoadingState()
            : _errorMessage != null
                ? _buildErrorState()
                : Listener(
                    behavior: HitTestBehavior.translucent,
                    onPointerDown: _onUserInteraction,
                    onPointerMove: _onUserInteraction,
                    onPointerUp: _onUserInteraction,
                    child: !_menuMode
                        ? (_filteredProducts.isEmpty
                            ? GestureDetector(
                                behavior: HitTestBehavior.opaque,
                                onTap: _enterMenuMode,
                                child: _buildEmptyState(),
                              )
                            : GestureDetector(
                                onTap: _enterMenuMode,
                                child: _buildAttractMode(),
                              ))
                        : _viewingProduct
                            ? _buildProductViewer()
                            : SafeArea(
                                top: false,
                                child: Column(
                                  children: [
                                    _buildHeader(isTablet),
                                    Expanded(
                                      child: RefreshIndicator(
                                        onRefresh: () async {
                                          _onUserInteraction();
                                          await _loadProducts();
                                        },
                                        color: Theme.of(context)
                                            .colorScheme
                                            .primary,
                                        child: _buildMainContent(isTablet),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                  ),
      ),
    );
  }

  Widget _buildProductViewer() {
    return Stack(
      fit: StackFit.expand,
      children: [
        PageView.builder(
          key: const ValueKey('product-viewer'),
          controller: _productPageController,
          itemCount: _filteredProducts.length,
          onPageChanged: (index) {
            setState(() => _currentPage = index);
            _resetIdleTimer();
          },
          itemBuilder: (context, index) => ProductDetailsPage(
            product: _filteredProducts[index],
          ),
        ),
        Positioned(
          left: 24,
          top: 20,
          child: SafeArea(
            bottom: false,
            child: TextButton.icon(
              onPressed: _closeProduct,
              style: TextButton.styleFrom(
                backgroundColor: Colors.white.withValues(alpha: 0.85),
                foregroundColor: const Color(AppConstants.darkBrownValue),
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              ),
              icon: const Icon(Icons.arrow_back_rounded, size: 20),
              label: const Text('Back to menu'),
            ),
          ),
        ),
        Positioned(
          right: 32,
          top: 34,
          child: SafeArea(
            bottom: false,
            child: Text(
              '${_currentPage + 1} / ${_filteredProducts.length}',
              style: TextStyle(
                color: const Color(AppConstants.darkBrownValue)
                    .withValues(alpha: 0.5),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        if (_filteredProducts.length > 1) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: _buildProductArrow(
              'Previous product',
              Icons.chevron_left_rounded,
              _currentPage > 0 ? () => _changeProduct(-1) : null,
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: _buildProductArrow(
              'Next product',
              Icons.chevron_right_rounded,
              _currentPage < _filteredProducts.length - 1
                  ? () => _changeProduct(1)
                  : null,
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildProductArrow(
      String label, IconData icon, VoidCallback? onPressed) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: IconButton.filled(
        tooltip: label,
        onPressed: onPressed,
        iconSize: 34,
        style: IconButton.styleFrom(
          minimumSize: const Size(48, 56),
          backgroundColor: Colors.white.withValues(alpha: 0.65),
          foregroundColor:
              const Color(AppConstants.darkBrownValue).withValues(alpha: 0.42),
          disabledBackgroundColor: Colors.white.withValues(alpha: 0.25),
          disabledForegroundColor:
              const Color(AppConstants.darkBrownValue).withValues(alpha: 0.12),
        ),
        icon: Icon(icon),
      ),
    );
  }

  Widget _buildMainContent(bool isTablet) {
    if (_filteredProducts.isEmpty) {
      return Column(
        children: [
          const SizedBox(height: 10),
          if (_menuMode) _buildCategoryButtons(true),
          Expanded(child: _buildEmptyState()),
        ],
      );
    }

    // Attract mode: continuous full-screen name-only slideshow
    if (!_menuMode) {
      return _buildAttractMode();
    }

    // Menu mode: interactive category chips + product grid
    return Column(
      children: [
        const SizedBox(height: 10),
        _buildCategoryButtons(true),
        const SizedBox(height: 8),
        Expanded(child: _buildProductGrid()),
      ],
    );
  }

  /// Idle / attract: big image with name only, auto-advances
  Widget _buildAttractMode() {
    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 900),
          switchInCurve: Curves.easeIn,
          switchOutCurve: Curves.easeOut,
          transitionBuilder: (child, animation) =>
              FadeTransition(opacity: animation, child: child),
          child: _buildAttractSlide(
            _filteredProducts[_currentPage],
            key: ValueKey(_filteredProducts[_currentPage].id),
          ),
        ),
        // Subtle hint
        Positioned(
          bottom: 28,
          left: 0,
          right: 0,
          child: IgnorePointer(
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Text(
                  'Tap anywhere to browse the menu',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAttractSlide(Product product, {required Key key}) {
    final imageUrl = getSizedImageUrl(product.image, context);

    return Stack(
      key: key,
      fit: StackFit.expand,
      children: [
        CachedNetworkImage(
          imageUrl: imageUrl,
          fit: BoxFit.cover,
          placeholder: (context, url) => Container(
            color: const Color(
              AppConstants.darkBrownValue,
            ).withValues(alpha: 0.12),
            child: Center(
              child: SpinKitFoldingCube(
                color: Theme.of(context).colorScheme.primary,
                size: 50.0,
              ),
            ),
          ),
          errorWidget: (context, url, error) => Container(
            color: const Color(0xFFF3E9DC),
            child: const Icon(Icons.image_not_supported_outlined, size: 48),
          ),
        ),
        // Gradient for text readability
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          height: 220,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  const Color(
                    AppConstants.darkBrownValue,
                  ).withValues(alpha: 0.88),
                ],
              ),
            ),
          ),
        ),
        // Name only; prices are shown after entering the interactive menu.
        Positioned(
          left: 32,
          right: 32,
          bottom: 72,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                product.title,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                  letterSpacing: 0.3,
                ),
              ),
              if (!product.available) const Chip(label: Text('Sold out')),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildProductGrid() {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
      physics: const AlwaysScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 280,
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        childAspectRatio: 0.72,
      ),
      itemCount: _filteredProducts.length,
      itemBuilder: (context, index) {
        final product = _filteredProducts[index];
        return ProductCard(product: product, onTap: () => _openProduct(index));
      },
    );
  }

  Widget _buildHeader(bool isTablet) {
    return Container(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + (isTablet ? 8 : 6),
        bottom: isTablet ? 12 : 8,
        left: isTablet ? 16 : 8,
        right: isTablet ? 16 : 8,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Theme.of(context).colorScheme.primary,
            const Color(AppConstants.darkBrownValue),
          ],
        ),
      ),
      child: Row(
        children: [
          if (_menuMode)
            TextButton.icon(
              onPressed: _exitMenuMode,
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                backgroundColor: Colors.white.withValues(alpha: 0.15),
                padding: EdgeInsets.symmetric(
                  horizontal: isTablet ? 14 : 10,
                  vertical: isTablet ? 10 : 8,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                  side: BorderSide(color: Colors.white.withValues(alpha: 0.35)),
                ),
              ),
              icon: const Icon(Icons.arrow_back_rounded, size: 20),
              label: Text(
                'Back',
                style: TextStyle(
                  fontSize: isTablet ? 15 : 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            )
          else
            TextButton.icon(
              onPressed: _enterMenuMode,
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                backgroundColor: Colors.white.withValues(alpha: 0.15),
                padding: EdgeInsets.symmetric(
                  horizontal: isTablet ? 14 : 10,
                  vertical: isTablet ? 10 : 8,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                  side: BorderSide(color: Colors.white.withValues(alpha: 0.35)),
                ),
              ),
              icon: const Icon(Icons.grid_view_rounded, size: 18),
              label: Text(
                'Menu',
                style: TextStyle(
                  fontSize: isTablet ? 15 : 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          if (widget.headerLeadingAction != null) widget.headerLeadingAction!,
          Expanded(
            child: _menuMode
                ? Center(
                    child: Text(
                      widget.brandName,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: isTablet ? 24 : 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        letterSpacing: 0.4,
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
          widget.headerTrailingAction ?? const SizedBox(width: 56),
        ],
      ),
    );
  }

  Widget _buildCategoryButtons(bool isTablet) {
    if (_categories.isEmpty) return const SizedBox.shrink();

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: EdgeInsets.symmetric(horizontal: isTablet ? 24 : 12),
      child: Row(
        children: _categories.map((category) {
          final categoryId = category['id'] as String;
          final categoryName = category['name'] as String;
          final isActive = categoryId == _selectedCategory;

          return Padding(
            padding: EdgeInsets.only(right: isTablet ? 12 : 8),
            child: GestureDetector(
              onTap: () => _filterByCategory(categoryId),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                padding: EdgeInsets.symmetric(
                  horizontal: isTablet ? 20 : 14,
                  vertical: isTablet ? 10 : 8,
                ),
                decoration: BoxDecoration(
                  color: isActive
                      ? Theme.of(context).colorScheme.primary
                      : const Color(0xFFE8D0B3),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: isActive
                      ? [
                          BoxShadow(
                            color: Theme.of(context)
                                .colorScheme
                                .primary
                                .withValues(alpha: 0.3),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ]
                      : [],
                ),
                child: Text(
                  categoryName,
                  style: TextStyle(
                    color: isActive
                        ? Colors.white
                        : const Color(AppConstants.darkBrownValue),
                    fontWeight: FontWeight.w600,
                    fontSize: isTablet ? 14 : 13,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SpinKitFoldingCube(
            color: Theme.of(context).colorScheme.primary,
            size: 50.0,
          ),
          const SizedBox(height: 20),
          const Text(
            'Loading delicious products...',
            style: TextStyle(
              fontSize: 16,
              color: Color(AppConstants.darkBrownValue),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppConstants.defaultPadding * 2),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.error_outline,
                size: 60,
                color: Colors.red,
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Oops! Something went wrong',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Color(AppConstants.darkBrownValue),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              _errorMessage ?? 'Unknown error occurred',
              style: TextStyle(fontSize: 14, color: Colors.grey[700]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 30),
            ElevatedButton.icon(
              onPressed: _loadProducts,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 30,
                  vertical: 15,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Padding(
      padding: const EdgeInsets.all(AppConstants.defaultPadding * 2),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(
                AppConstants.goldAccentValue,
              ).withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.inventory_2_outlined,
              size: 60,
              color: Color(AppConstants.goldAccentValue),
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'No Products in this Category',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Color(AppConstants.darkBrownValue),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Try selecting a different category!',
            style: TextStyle(fontSize: 14, color: Colors.grey[700]),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
