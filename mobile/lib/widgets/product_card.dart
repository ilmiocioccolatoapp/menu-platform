import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../models/product.dart';
import '../utils/constants.dart';
import '../utils/image_utils.dart';
import 'price_text.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback? onTap;
  final bool showImage;
  final bool showDescription;
  final bool compact;

  const ProductCard({
    super.key,
    required this.product,
    this.onTap,
    this.showImage = true,
    this.showDescription = true,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final imgUrl = getSizedImageUrl(product.image, context);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (showImage)
                Expanded(
                  flex: compact ? 5 : 6,
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(18),
                    ),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        CachedNetworkImage(
                          imageUrl: imgUrl,
                          fit: BoxFit.cover,
                          placeholder: (context, url) => Container(
                            color: const Color(0xFFF3E9DC),
                            child: Center(
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Theme.of(context).colorScheme.primary,
                              ),
                            ),
                          ),
                          errorWidget: (context, url, error) => Container(
                            color: const Color(0xFFF3E9DC),
                            child: const Icon(
                              Icons.image_not_supported_outlined,
                              color: Color(AppConstants.darkBrownValue),
                              size: 36,
                            ),
                          ),
                        ),
                        if (!product.available)
                          const Positioned(
                              top: 8,
                              right: 8,
                              child: Chip(label: Text('Sold out'))),
                      ],
                    ),
                  ),
                ),
              Expanded(
                flex: compact ? 3 : 4,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: Color(AppConstants.darkBrownValue),
                          height: 1.2,
                        ),
                      ),
                      if (showDescription) ...[
                        const SizedBox(height: 4),
                        Expanded(
                          child: Text(
                            product.description,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: compact ? 11.5 : 12.5,
                              height: 1.35,
                              color: Colors.grey.shade700,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 5,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(
                                AppConstants.goldAccentValue,
                              ).withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: const Color(
                                  AppConstants.goldAccentValue,
                                ).withValues(alpha: 0.5),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: product.sizes.isNotEmpty
                                  ? product.startingSize == null
                                      ? const [Text('Unavailable')]
                                      : [
                                          const Text('From ',
                                              style: TextStyle(fontSize: 11)),
                                          PriceText(
                                            product.startingSize!.price,
                                            style: TextStyle(
                                              fontSize: 14,
                                              fontWeight: FontWeight.w800,
                                              color: Theme.of(context)
                                                  .colorScheme
                                                  .primary,
                                            ),
                                          ),
                                        ]
                                  : [
                                      PriceText(
                                        product.price,
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w800,
                                          color: Theme.of(context)
                                              .colorScheme
                                              .primary,
                                        ),
                                      ),
                                    ],
                            ),
                          ),
                          const Spacer(),
                          const Icon(
                            Icons.arrow_forward_ios_rounded,
                            size: 14,
                            color: Color(AppConstants.darkBrownValue),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
