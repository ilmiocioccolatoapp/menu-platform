import { displayPrice } from '../utils/price';
import { useState } from 'react';
import { useCatalog } from '../data/CatalogContext';
import { catalogImageUrl } from '../utils/image';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  CoffeeCupIcon
} from './Icons';

const ProductList = ({ onEdit }) => {
  const { products, categories, productsLoading: loading, productsError, categoriesError,
    deleteProduct, toggleProduct, refreshProducts, refreshCategories } = useCatalog();
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState({});

  const handleDelete = async (id, title) => {
    if (!window.confirm(`Are you sure you want to remove "${title}" from the catalog? This action will remove it from the tablet menu.`)) {
      return;
    }

    try {
      setPending(previous => ({ ...previous, [id]: true }));
      await deleteProduct(id);
    } catch (error) {
      console.error('Error deleting product:', error);
      alert('Failed to delete product');
    } finally {
      setPending(previous => ({ ...previous, [id]: false }));
    }
  };

  const handleToggle = async (id) => {
    try {
      setPending(previous => ({ ...previous, [id]: true }));
      await toggleProduct(id);
    } catch (error) {
      console.error('Error toggling availability:', error);
      alert('Failed to toggle availability');
    } finally {
      setPending(previous => ({ ...previous, [id]: false }));
    }
  };

  const filteredProducts = products.filter(product => {
    if (filter === 'all') return true;
    if (filter === 'available') return product.available;
    if (filter === 'unavailable') return !product.available;
    const cat = product.category?.toLowerCase() || '';
    return cat === filter.toLowerCase();
  });
  const categoriesById = new Map(categories.map(category => [category.id, category]));
  const categoriesByDatabaseId = new Map(categories.map(category => [category.dbId, category]));
  const groupedProducts = filteredProducts.reduce((groups, product) => {
    const category = categoriesById.get(product.category);
    const mainCategory = category?.parentId
      ? categoriesByDatabaseId.get(category.parentId)
      : category;
    const groupId = mainCategory?.id || null;
    const existing = groups.get(groupId) || {
      id: groupId,
      key: mainCategory ? `category:${mainCategory.id}` : 'orphan-products',
      name: mainCategory?.name || 'Uncategorized',
      order: mainCategory?.order ?? Number.MAX_SAFE_INTEGER,
      products: []
    };
    groups.set(groupId, {
      ...existing,
      products: [...existing.products, product]
    });
    return groups;
  }, new Map());
  const productGroups = [...groupedProducts.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name)
  );

  if (loading) {
    return (
      <div className="page-container">
        <div className="section-header">
          <div>
            <h2 className="section-title">Product Catalog</h2>
            <p className="section-subtitle">Loading catalog registry...</p>
          </div>
        </div>
        <p style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>Reading product data from database...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">Product Catalog ({filteredProducts.length})</h2>
          <p className="section-subtitle">Manage artisan recipes, pricing, and live kiosk availability</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="filter-controls">
            <select
              className="select-ledger"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter products by category or availability"
            >
              <option value="all">All Items ({products.length})</option>
              <option value="available">Available for Service</option>
              <option value="unavailable">Suspended / Out of Stock</option>
              {categories.length === 0 ? (
                <option disabled value="">No categories found</option>
              ) : (
                <optgroup label="Categories">
                  {categories.map(cat => {
                    const value = cat.id || cat.name;
                    const label = (cat.name || cat.id || '').toUpperCase();
                    return (
                      <option key={cat._id || cat.id} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => onEdit(null)}>
            <PlusIcon />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {(productsError || categoriesError) && <div role="alert" className="data-error">
        Some catalog data could not be refreshed. <button className="btn btn-ghost btn-sm" onClick={() => Promise.allSettled([refreshProducts(), refreshCategories()])}>Retry</button>
      </div>}
      {filteredProducts.length === 0 ? (
        <div className="editorial-empty-state" style={{ margin: '40px auto' }}>
          <h3>No products match this ledger filter</h3>
          <p>
            {filter === 'all'
              ? 'Your bakery ledger is currently empty. Start by cataloging your first artisan creation.'
              : `No items found under "${filter}". Try selecting another category or clear the filter.`}
          </p>
          <button className="btn btn-primary" onClick={() => { setFilter('all'); onEdit(null); }}>
            <PlusIcon />
            <span>Publish New Product</span>
          </button>
        </div>
      ) : (
        productGroups.map(group => (
          <section key={group.key} aria-labelledby={`product-group-${group.key}`}>
            <h2
              id={`product-group-${group.key}`}
              className="section-title"
              style={{ margin: '28px 0 14px' }}
            >
              {group.name} ({group.products.length})
            </h2>
            <div className="products-grid">
              {group.products.map(product => {
                const productId = product._id || product.dbId || product.id;
                return (
                  <article key={productId} className={`product-card ${!product.available ? 'unavailable' : ''}`}>
                    <ProductImage product={product} />
                    <div className="product-content">
                      <div className="product-header">
                        <h3>{product.title}</h3>
                        <span className="category-tag">{product.category}</span>
                      </div>

                      <p className="product-description">
                        {product.description}
                      </p>

                      {product.ingredients && (
                        <p className="ingredients-note">
                          {product.ingredients}
                        </p>
                      )}

                      <div className="product-price">
                        {product.sizes?.length ? (
                          <div className="product-size-prices">
                            {product.sizes.map(size => (
                              <span key={size.id}>
                                {size.name}: {displayPrice(`${product.currency || 'AED'} ${size.priceAmount}`)}
                              </span>
                            ))}
                          </div>
                        ) : displayPrice(product.price)}
                      </div>

                      <div className="product-actions">
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={pending[productId]}
                          onClick={() => handleToggle(productId)}
                          title={product.available ? 'Suspend from menu' : 'Make available for service'}
                        >
                          {product.available ? <PauseCircleIcon /> : <PlayCircleIcon />}
                          <span>{pending[productId] ? 'Saving...' : product.available ? 'Suspend' : 'Resume'}</span>
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={pending[productId]}
                          onClick={() => onEdit(product)}
                          title="Edit product details"
                        >
                          <PencilIcon />
                          <span>Edit</span>
                        </button>
                        <button
                          className="btn btn-sm btn-ghost-danger"
                          disabled={pending[productId]}
                          onClick={() => handleDelete(productId, product.title)}
                          title="Delete from catalog"
                        >
                          <TrashIcon />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = catalogImageUrl(product.image || product.imageUrl || product.image_url);
  return (
    <div className="product-image">
      {imageUrl && !failed
        ? <img src={imageUrl} alt={product.title} loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : <div className="product-image-placeholder" role="img" aria-label={`${product.title} image unavailable`}><CoffeeCupIcon size={46} /></div>}
      <div className={`status-indicator ${product.available ? 'available' : 'unavailable'}`}>
        <span className="status-dot"></span>
        <span>{product.available ? 'Available' : 'Suspended'}</span>
      </div>
    </div>
  );
}

export default ProductList;
