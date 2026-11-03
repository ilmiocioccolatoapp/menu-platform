import { useState, useEffect } from 'react';
import { useCatalog } from '../data/CatalogContext';
import { CloseIcon } from './Icons';
import { DIRHAM_SYMBOL } from '../utils/price';

const getPriceCurrency = (price) => price.trim().startsWith('€') ? '€' : (price.trim().match(/^[A-Z]{3}/)?.[0] || 'AED');

const getPriceAmount = (price) => price.trim().replace(/^([A-Z]{3}|€|\u20C3)\s*/, '');

const formatPrice = (price) => {
  const currency = getPriceCurrency(price);
  const amount = getPriceAmount(price);
  const [whole, fraction = ''] = amount.split('.');
  const formattedAmount = `${whole}.${fraction.padEnd(2, '0')}`;
  return currency === '€' ? `€${formattedAmount}` : `${currency} ${formattedAmount}`;
};
const newOptionId = () => `option-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const validAmount = value => /^\d{1,8}(?:\.\d{0,2})?$/.test(String(value));
const initialGroup = name => {
  const milk = name.toLowerCase().includes('milk');
  const optionNames = milk ? ['Whole milk', 'Oat milk', 'Almond milk'] : name.toLowerCase().includes('syrup') ? ['Vanilla', 'Caramel', 'Hazelnut'] : ['Extra shot'];
  return {
    id: newOptionId(),
    name,
    selection: milk ? 'single' : 'multiple',
    options: optionNames.map(optionName => ({ id: newOptionId(), name: optionName, priceAmount: '0.00' }))
  };
};

const ProductForm = ({ product, onSuccess, onCancel }) => {
  const [formData, setFormData] = useState({
    title: '',
    category: 'pastries',
    description: '',
    ingredients: '',
    price: 'AED 0.00',
    available: true,
    sizes: [],
    addOnGroups: []
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [mainCategory, setMainCategory] = useState('');
  const { categories, saveProduct, brand } = useCatalog();
  const mainCategories = categories.filter(category => !category.parentId);
  const selectedMain = mainCategories.find(category => category.id === mainCategory);
  const subcategories = categories.filter(
    category => category.parentId === selectedMain?.dbId
  );

  const getErrorMessage = (error) => {
    if (!error) return 'Failed to save product';
    if (typeof error === 'string') return error;
    if (Array.isArray(error)) return error.join(', ');
    if (Array.isArray(error.error)) return error.error.join(', ');
    return error.error || error.message || 'Failed to save product';
  };

  useEffect(() => {
    if (product) {
      setFormData({
        title: product.title,
        category: product.category,
        description: product.description,
        ingredients: product.ingredients,
        price: product.price,
        available: product.available,
        sizes: Array.isArray(product.sizes) ? product.sizes : [],
        addOnGroups: Array.isArray(product.addOnGroups) ? product.addOnGroups : []
      });
      setImagePreview(product.image);
    }
  }, [product]);

  useEffect(() => {
    if (!product || !categories.length) return;
    const selectedCategory = categories.find(category => category.id === product.category);
    const parent = categories.find(category => category.dbId === selectedCategory?.parentId);
    setMainCategory(parent?.id || selectedCategory?.id || '');
  }, [product, categories]);

  useEffect(() => { if (!product && brand?.currency) setFormData(previous => ({...previous, price: (brand.currency === 'EUR' ? '€' : brand.currency + ' ') + '0.00'})); }, [brand?.currency, product]);

  const defaultCategory = mainCategories[0]?.id;
  const defaultCategoryDbId = mainCategories[0]?.dbId;
  useEffect(() => {
    if (!product && defaultCategory) {
      const children = categories.filter(
        category => category.parentId === defaultCategoryDbId
      );
      setMainCategory(defaultCategory);
      setFormData(previous => previous.category
        ? previous
        : { ...previous, category: children[0]?.id || defaultCategory });
    }
  }, [product, defaultCategory, defaultCategoryDbId, categories]);

  useEffect(() => {
    if (!imageFile) return undefined;
    const preview = URL.createObjectURL(imageFile);
    setImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [imageFile]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.title.trim()) newErrors.title = 'Title is required';
    if (selectedMain && subcategories.length > 0
      && !subcategories.some(category => category.id === formData.category)) {
      newErrors.category = 'Select a subcategory';
    }
    if (!imageFile && !imagePreview) newErrors.image = 'Image is required';
    if (!formData.description.trim()) newErrors.description = 'Description is required';
    if (!formData.ingredients.trim()) newErrors.ingredients = 'Ingredients are required';
    if (formData.sizes.length === 0 && !/^\d+(?:\.\d{0,2})?$/.test(getPriceAmount(formData.price))) {
      newErrors.price = 'Enter a price with up to 2 decimal places';
    }
    if (formData.sizes.some(size => !size.name.trim() || !validAmount(size.priceAmount))) {
      newErrors.sizes = 'Enter a name and a valid price for every size.';
    }
    if (formData.addOnGroups.some(group => !group.name.trim() || !group.options.length
      || group.options.some(option => !option.name.trim() || !validAmount(option.priceAmount)))) {
      newErrors.addOnGroups = 'Each add-on group and option needs a name, and every option needs a valid price.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handlePriceChange = (e) => {
    const currency = getPriceCurrency(formData.price);
    const amount = e.target.value;
    setFormData(prev => ({
      ...prev,
      price: currency === '€' ? `€${amount}` : `${currency} ${amount}`
    }));
    if (errors.price) setErrors(prev => ({ ...prev, price: '' }));
  };

  const handleMainCategoryChange = (e) => {
    const nextMainCategory = e.target.value;
    const nextMain = mainCategories.find(category => category.id === nextMainCategory);
    const children = categories.filter(
      category => category.parentId === nextMain?.dbId
    );
    setMainCategory(nextMainCategory);
    setFormData(previous => ({
      ...previous,
      category: children[0]?.id || nextMainCategory
    }));
    setErrors(previous => ({ ...previous, category: '' }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      if (errors.image) setErrors(prev => ({ ...prev, image: '' }));
    }
  };

  const updateSize = (index, field, value) => {
    setFormData(previous => ({ ...previous, sizes: previous.sizes.map((size, itemIndex) => itemIndex === index ? { ...size, [field]: value } : size) }));
    setErrors(previous => ({ ...previous, sizes: '' }));
  };
  const updateGroup = (groupIndex, update) => {
    setFormData(previous => ({ ...previous, addOnGroups: previous.addOnGroups.map((group, index) => index === groupIndex ? update(group) : group) }));
    setErrors(previous => ({ ...previous, addOnGroups: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !validateForm()) return;

    setLoading(true);
    try {
      const payload = {
        fields: { ...formData, price: formatPrice(formData.price) },
        file: imageFile
      };
      await saveProduct(product?._id || product?.dbId || product?.id, payload);
      onSuccess();
    } catch (error) {
      console.error('Error saving product:');
      alert(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="product-form-container">
      <div className="product-form">
        <div className="form-header">
          <h2>{product ? 'Edit Product' : 'Add New Product'}</h2>
          <button className="btn-close" onClick={onCancel} type="button">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title">Title *</label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className={errors.title ? 'error' : ''}
            maxLength="100"
          />
          {errors.title && <span className="error-message">{errors.title}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="mainCategory">Main Category *</label>
          <select
            id="mainCategory"
            value={mainCategory}
            onChange={handleMainCategoryChange}
          >
            {mainCategories.map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="category">Subcategory *</label>
          <select
            id="category"
            name="category"
            value={formData.category}
            onChange={handleChange}
            disabled={subcategories.length === 0}
            className={errors.category ? 'error' : ''}
          >
            {subcategories.length > 0 ? (
              subcategories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))
            ) : (
              <option value={mainCategory}>No subcategories — use main category</option>
            )}
          </select>
          {errors.category && <span className="error-message">{errors.category}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="image">Product Image *</label>
          <input
            type="file"
            id="image"
            accept="image/*"
            onChange={handleImageChange}
            className={errors.image ? 'error' : ''}
          />
          {imagePreview && (
            <div className="image-preview" style={{ marginTop: '10px' }}>
              <img
                src={imagePreview}
                alt="Preview"
                style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '5px' }}
              />
            </div>
          )}
          {errors.image && <span className="error-message">{errors.image}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="description">Description *</label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            className={errors.description ? 'error' : ''}
            rows="3"
            maxLength="500"
          />
          {errors.description && <span className="error-message">{errors.description}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="ingredients">Ingredients *</label>
          <textarea
            id="ingredients"
            name="ingredients"
            value={formData.ingredients}
            onChange={handleChange}
            className={errors.ingredients ? 'error' : ''}
            rows="2"
          />
          {errors.ingredients && <span className="error-message">{errors.ingredients}</span>}
        </div>

        {formData.sizes.length === 0 ? (
          <div className="form-group">
            <label htmlFor="price">Price *</label>
            <div className={`price-input${errors.price ? ' error' : ''}`}>
              <span aria-label={getPriceCurrency(formData.price) === 'AED' ? 'UAE dirhams' : 'Euros'}>
                {getPriceCurrency(formData.price) === 'AED' ? DIRHAM_SYMBOL : getPriceCurrency(formData.price)}
              </span>
              <input
                type="text"
                inputMode="decimal"
                id="price"
                name="price"
                value={getPriceAmount(formData.price)}
                onChange={handlePriceChange}
                aria-invalid={Boolean(errors.price)}
                placeholder="0.00"
              />
            </div>
            {errors.price && <span className="error-message">{errors.price}</span>}
          </div>
        ) : (
          <p className="product-size-price-note" role="status">
            Size prices are used instead of a base price. The lowest size price is used for compatibility with older menu clients.
          </p>
        )}

        <section className="product-options-editor" aria-labelledby="product-sizes-heading">
          <div className="product-options-heading">
            <div>
              <h3 id="product-sizes-heading">Sizes &amp; prices</h3>
              <p>For drinks, add each size with its price. Customers can view these on the tablet.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFormData(previous => ({ ...previous, sizes: [...previous.sizes, { id: newOptionId(), name: '', priceAmount: '' }] }))}>+ Add size</button>
          </div>
          {formData.sizes.map((size, index) => (
            <div className="product-option-row" key={size.id}>
              <label>Size
                <input aria-label={`Size ${index + 1} name`} value={size.name} maxLength="60" placeholder="Small, Medium, Large" onChange={event => updateSize(index, 'name', event.target.value)} />
              </label>
              <label>Price ({brand?.currency || 'AED'})
                <input aria-label={`Size ${index + 1} price`} inputMode="decimal" value={size.priceAmount} placeholder="0.00" onChange={event => updateSize(index, 'priceAmount', event.target.value)} />
              </label>
              <button type="button" className="icon-danger-button" aria-label={`Remove size ${index + 1}`} onClick={() => setFormData(previous => ({ ...previous, sizes: previous.sizes.filter((_, itemIndex) => itemIndex !== index) }))}>×</button>
            </div>
          ))}
          {errors.sizes && <span className="error-message" role="alert">{errors.sizes}</span>}
        </section>

        <section className="product-options-editor" aria-labelledby="product-addons-heading">
          <div className="product-options-heading">
            <div>
              <h3 id="product-addons-heading">Add-ons &amp; extra prices</h3>
              <p>Set extra charges for shots, milk options, syrups, or your own group.</p>
            </div>
          </div>
          <div className="product-option-presets">
            {['Extra shot', 'Milk options', 'Syrups'].map(name => (
              <button key={name} type="button" className="btn btn-ghost btn-sm" onClick={() => setFormData(previous => ({ ...previous, addOnGroups: [...previous.addOnGroups, initialGroup(name)] }))}>+ {name}</button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFormData(previous => ({ ...previous, addOnGroups: [...previous.addOnGroups, initialGroup('Other add-ons')] }))}>+ Other group</button>
          </div>
          {formData.addOnGroups.map((group, groupIndex) => (
            <fieldset className="product-addon-group" key={group.id}>
              <div className="product-addon-heading">
                <label>Group name
                  <input aria-label={`Add-on group ${groupIndex + 1} name`} value={group.name} maxLength="60" onChange={event => updateGroup(groupIndex, current => ({ ...current, name: event.target.value }))} />
                </label>
                <label>Selection
                  <select aria-label={`Add-on group ${groupIndex + 1} selection`} value={group.selection} onChange={event => updateGroup(groupIndex, current => ({ ...current, selection: event.target.value }))}>
                    <option value="single">Choose one</option>
                    <option value="multiple">Choose multiple</option>
                  </select>
                </label>
                <button type="button" className="icon-danger-button" aria-label={`Remove add-on group ${groupIndex + 1}`} onClick={() => setFormData(previous => ({ ...previous, addOnGroups: previous.addOnGroups.filter((_, index) => index !== groupIndex) }))}>×</button>
              </div>
              {group.options.map((option, optionIndex) => (
                <div className="product-option-row" key={option.id}>
                  <label>Option
                    <input aria-label={`${group.name || `Group ${groupIndex + 1}`} option ${optionIndex + 1} name`} value={option.name} maxLength="60" onChange={event => updateGroup(groupIndex, current => ({ ...current, options: current.options.map((item, index) => index === optionIndex ? { ...item, name: event.target.value } : item) }))} />
                  </label>
                  <label>Extra ({brand?.currency || 'AED'})
                    <input aria-label={`${group.name || `Group ${groupIndex + 1}`} option ${optionIndex + 1} price`} inputMode="decimal" value={option.priceAmount} placeholder="0.00" onChange={event => updateGroup(groupIndex, current => ({ ...current, options: current.options.map((item, index) => index === optionIndex ? { ...item, priceAmount: event.target.value } : item) }))} />
                  </label>
                  <button type="button" className="icon-danger-button" aria-label={`Remove ${option.name || `option ${optionIndex + 1}`}`} onClick={() => updateGroup(groupIndex, current => ({ ...current, options: current.options.filter((_, index) => index !== optionIndex) }))}>×</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateGroup(groupIndex, current => ({ ...current, options: [...current.options, { id: newOptionId(), name: '', priceAmount: '' }] }))}>+ Add option</button>
            </fieldset>
          ))}
          {errors.addOnGroups && <span className="error-message" role="alert">{errors.addOnGroups}</span>}
        </section>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              name="available"
              checked={formData.available}
              onChange={handleChange}
            />
            <span>Available for sale</span>
          </label>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Recording...' : (product ? 'Save draft changes' : 'Save product draft')}
          </button>
        </div>
      </form>
    </div>
  </div>
  );
};

export default ProductForm;
