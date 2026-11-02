import { useState } from 'react';
import { useCatalog } from '../data/CatalogContext';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CloseIcon
} from './Icons';

const Categories = () => {
  const { categories, categoriesLoading: loading, categoriesError, refreshCategories,
    saveCategory, deleteCategory } = useCatalog();
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    icon: '✨',
    order: 0,
    parentId: ''
  });

  const handleAdd = () => {
    setEditingCategory(null);
    setFormData({
      id: '',
      name: '',
      icon: '✨',
      order: categories.length + 1
      ,parentId: ''
    });
    setShowModal(true);
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setFormData({
      id: category.id,
      name: category.name,
      icon: category.icon || '✨',
      order: category.order || 0
      ,parentId: category.parentId || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (category) => {
    if (!window.confirm(`Are you sure you want to delete category "${category.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setPendingDelete(previous => ({ ...previous, [category.id]: true }));
      await deleteCategory(category._id || category.dbId);
    } catch (error) {
      console.error('Error deleting category:', error);
      alert(error.error || 'Failed to delete category');
    } finally {
      setPendingDelete(previous => ({ ...previous, [category.id]: false }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (saving) return;
    setSaving(true);
    try {
      await saveCategory(editingCategory?._id || editingCategory?.dbId, formData);
      setShowModal(false);
    } catch (error) {
      console.error('Error saving category:', error);
      alert(error.error || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'order' ? parseInt(value) || 0 : value
    }));
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="section-header">
          <div>
            <h2 className="section-title">Category Registry</h2>
            <p className="section-subtitle">Loading bakehouse departments...</p>
          </div>
        </div>
        <p style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>Reading category configuration...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">Category Registry ({categories.length})</h2>
          <p className="section-subtitle">Department hierarchy, tablet gallery sequence, and kiosk order</p>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}>
          <PlusIcon />
          <span>Add Category</span>
        </button>
      </div>

      {categoriesError && <div role="alert" className="data-error">
        Could not refresh categories. <button className="btn btn-ghost btn-sm" onClick={() => refreshCategories().catch(() => {})}>Retry</button>
      </div>}
      <div className="stats-grid">
        {categories.map(cat => (
          <div key={cat.id} className="category-card">
            <div className="category-card-top">
              <span className="category-order">Position #{cat.order || '—'}</span>
              {cat.icon && (
                <span style={{ fontSize: '1.25rem' }}>{cat.icon}</span>
              )}
            </div>

            <h3 className="category-name">{cat.name}</h3>
            {cat.parent && <div className="category-count">↳ {cat.parent.name}</div>}

            <div className="category-count">
              {cat.count !== undefined ? `${cat.count} ${cat.count === 1 ? 'product' : 'products'}` : 'Active category'}
            </div>

            <div className="category-actions">
              <button
                className="btn btn-sm btn-ghost"
                disabled={pendingDelete[cat.id]}
                onClick={() => handleEdit(cat)}
                title="Edit category name or order"
              >
                <PencilIcon />
                <span>Edit</span>
              </button>
              <button
                className="btn btn-sm btn-ghost-danger"
                disabled={pendingDelete[cat.id]}
                onClick={() => handleDelete(cat)}
                title="Delete category"
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="product-form-container">
          <div className="product-form" style={{ maxWidth: '520px' }}>
            <div className="form-header">
              <h2>{editingCategory ? 'Edit Category' : 'New Department Category'}</h2>
              <button className="btn-close" disabled={saving} onClick={() => setShowModal(false)} type="button">
                <CloseIcon />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Parent Main Category</label>
                <select name="parentId" value={formData.parentId} onChange={handleInputChange}>
                  <option value="">None (Main category)</option>
                  {categories.filter(category => category.id !== editingCategory?.id && !category.parentId).map(category => (
                    <option key={category._id || category.dbId} value={category._id || category.dbId}>{category.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Category Identifier (Slug) *</label>
                <input
                  type="text"
                  name="id"
                  value={formData.id}
                  onChange={handleInputChange}
                  required
                  disabled={!!editingCategory}
                  placeholder="e.g. pastries, specialty-chocolates"
                />
              </div>

              <div className="form-group">
                <label>Display Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  placeholder="e.g. Viennoiserie & Pastries"
                />
              </div>

              <div className="form-group">
                <label>Icon Symbol (Kiosk Header)</label>
                <input
                  type="text"
                  name="icon"
                  value={formData.icon}
                  onChange={handleInputChange}
                  placeholder="e.g. 🥐 or ✨"
                />
              </div>

              <div className="form-group">
                <label>Display Order Sequence (Ascending)</label>
                <input
                  type="number"
                  name="order"
                  value={formData.order}
                  onChange={handleInputChange}
                  min="0"
                />
              </div>

              <div className="form-actions" style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving} onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? 'Saving...' : editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Categories;
