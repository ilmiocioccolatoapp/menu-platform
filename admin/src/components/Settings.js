import {useState} from 'react';
import {platformService} from '../services/api';
const Settings=({brand,onSaved,canEditSlug=false})=>{
 const [form,setForm]=useState({name:brand.name,slug:brand.slug,logoUrl:brand.logoUrl||'',primaryColor:brand.primaryColor||'#8B4513',currency:brand.currency,timezone:brand.timezone,presentation:{categoryNavigation:brand.presentation?.categoryNavigation||'horizontal',productCardDensity:brand.presentation?.productCardDensity||'comfortable',showImages:brand.presentation?.showImages!==false,showDescriptions:brand.presentation?.showDescriptions!==false}});
 const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const change=e=>setForm({...form,[e.target.name]:e.target.value});
 const changePresentation=e=>setForm({...form,presentation:{...form.presentation,[e.target.name]:e.target.type==='checkbox'?e.target.checked:e.target.value}});
 const save=async e=>{e.preventDefault();if(saving)return;setSaving(true);setMessage('');try{await platformService.put('/brands/'+brand.id+'/settings',form);setMessage('Settings saved as a draft. Publish the affected store menus to update tablets.');await onSaved();}catch(error){setMessage(error.error||error.message||'Could not save settings.');}finally{setSaving(false);}};
 return <div className="page-container"><h2 className="section-title">Brand settings</h2><p>Brand identity applies to this brand at every assigned location.</p><form className="ledger-card" onSubmit={save}>
  {['name',...(canEditSlug?['slug']:[]),'logoUrl','primaryColor','timezone'].map(field=><div className="form-group" key={field}><label htmlFor={field}>{{name:'Brand name',slug:'Brand code',logoUrl:'Logo URL',primaryColor:'Primary color',timezone:'Timezone'}[field]}</label><input id={field} name={field} value={form[field]} onChange={change} type={field==='primaryColor'?'color':'text'}/></div>)}
  {!canEditSlug&&<p>Brand code changes are managed by a platform administrator.</p>}
  <div className="form-group"><label htmlFor="currency">Currency</label><select id="currency" name="currency" value={form.currency} onChange={change}>{['AED','EUR','USD','GBP'].map(c=><option key={c}>{c}</option>)}</select><small>Currency changes require an empty catalog to avoid changing existing amounts.</small></div>
  <h3>Tablet presentation</h3>
  <div className="form-group"><label htmlFor="categoryNavigation">Category navigation</label><select id="categoryNavigation" name="categoryNavigation" value={form.presentation.categoryNavigation} onChange={changePresentation}><option value="horizontal">Horizontal tabs</option><option value="accordion">Accordion</option></select></div>
  <div className="form-group"><label htmlFor="productCardDensity">Product card density</label><select id="productCardDensity" name="productCardDensity" value={form.presentation.productCardDensity} onChange={changePresentation}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
  <label><input type="checkbox" name="showImages" checked={form.presentation.showImages} onChange={changePresentation}/> Show product images</label>
  <label><input type="checkbox" name="showDescriptions" checked={form.presentation.showDescriptions} onChange={changePresentation}/> Show product descriptions</label>
  {message&&<p role="status">{message}</p>}<button className="btn btn-primary" disabled={saving}>{saving?'Saving…':'Save settings'}</button>
 </form></div>;
};
export default Settings;
