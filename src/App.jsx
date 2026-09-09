import { useState, useEffect, useRef } from 'react'
import dimpzCafeLogo from '@/imports/D.png'
import { supabase } from '@/lib/supabase'
import * as api from '@/lib/api'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } from 'docx'
import { saveAs } from 'file-saver'

const SUGGESTED_CATEGORIES = ['Coffee', 'Tea', 'Pastry', 'Food', 'Drinks']
const DRINK_CATEGORIES = new Set(['Coffee', 'Tea', 'Drinks'])
const PASTRY_FOOD_CATEGORIES = new Set(['Pastry', 'Food'])

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'products', label: 'Products', icon: '◈' },
  { id: 'checkout', label: 'Checkout', icon: '◎' },
  { id: 'inventory', label: 'Inventory', icon: '≡' },
  { id: 'customers', label: 'Customers', icon: '◉' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '◬' },
]

const SETTINGS_STORAGE_KEY = 'dimpzcafe-settings'
const DEFAULT_SETTINGS = {
  businessName: "Dimp'z Cafe",
  email: 'hello@dimpzcafe.com',
  currency: 'PHP',
  taxRate: '8',
  receiptPrinting: true,
  soundEffects: false,
  lowStockAlerts: true,
  darkMode: false,
  language: 'English',
  timezone: 'Asia/Manila',
}

function formatPHP(amount) {
  const value = Number(amount) || 0
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  const remMin = diffMin % 60
  if (diffHr < 24) return remMin > 0 ? `${diffHr}h ${remMin}m ago` : `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

const CATEGORY_COLORS = ['#2c2416', '#ddcca6', '#c4ae88', '#e8ddc8', '#a8977e', '#7a6a50', '#b85c42', '#6b9e72']

function resizeImageFile(file, maxDim = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        // PNG preserves the alpha channel — no background fill, so any
        // transparency in the source survives the resize untouched.
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Icons as simple SVG components
function IconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}
function IconBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  )
}
function IconCart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}
function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function IconChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  )
}
function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M20 12h2M2 12h2M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41" />
    </svg>
  )
}
function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}
function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function IconMinus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
function IconKebab() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
    </svg>
  )
}
function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" />
    </svg>
  )
}
function IconTable() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  )
}
function IconFileText() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  )
}

const NAV_ICONS = {
  dashboard: <IconGrid />,
  products: <IconBox />,
  checkout: <IconCart />,
  inventory: <IconList />,
  customers: <IconUsers />,
  reports: <IconChart />,
  settings: <IconSettings />,
}

const inputClass = 'w-full px-3.5 py-2.5 rounded-xl border border-[#e8ddc8] text-sm text-[#2c2416] placeholder-[#c4ae88] focus:outline-none focus:border-[#ddcca6] focus:ring-2 focus:ring-[#ddcca6]/20 transition-all'
const labelClass = 'text-xs font-medium text-[#a8977e] block mb-1.5'

// ─── Shared Modal shell ─────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0e8d8]">
          <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416]">{title}</h2>
          <button onClick={onClose} className="text-[#a8977e] hover:text-[#2c2416] transition-colors">
            <IconX />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ─── Shared loading / error states ─────────────────────────────────────────
function Spinner({ className = 'w-8 h-8' }) {
  return <div className={`${className} border-2 border-[#ddcca6] border-t-[#2c2416] rounded-full animate-spin`} />
}

function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-[#a8977e]">
      <Spinner className="w-8 h-8 mb-3" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div className="text-center py-16 bg-[#fdf0ec] border border-[#f3d9d0] rounded-2xl text-[#b85c42]">
      <p className="font-medium mb-1">Something went wrong</p>
      <p className="text-sm">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-xs font-medium underline hover:no-underline">
          Try again
        </button>
      )}
    </div>
  )
}

function ConfirmDialog({ title, message, confirmLabel = 'Remove', onConfirm, onCancel, loading, error }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416] mb-2">{title}</h2>
        <p className="text-sm text-[#7a6a50] mb-4">{message}</p>
        {error && <p className="text-xs text-[#b85c42] mb-4">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-[#e8ddc8] text-sm font-medium text-[#7a6a50] hover:border-[#ddcca6] transition-all disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[#b85c42] text-white hover:bg-[#a04030] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Spinner className="w-4 h-4" />}
            {loading ? 'Removing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Product image box — shared by the catalog card and the form preview so
// the preview always matches the real card exactly ──────────────────────────
function ProductImageBox({ image, imageSize = 100, alt, className = '' }) {
  return (
    <div className={`flex items-center justify-center overflow-hidden ${className}`}>
      {image ? (
        <img
          src={image}
          alt={alt}
          className="w-full h-full object-contain"
          style={{ transform: `scale(${imageSize / 100})` }}
        />
      ) : (
        <span className="text-4xl">🍽️</span>
      )}
    </div>
  )
}

// ─── Add/Edit Product modal (Products screen) ──────────────────────────────
function AddProductModal({ onClose, onSubmit, product }) {
  const isEdit = Boolean(product)
  const [name, setName] = useState(product?.name || '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [costPrice, setCostPrice] = useState(product?.costPrice ? String(product.costPrice) : '')
  const [category, setCategory] = useState(product?.category || '')
  const [stock, setStock] = useState(product ? String(product.stock) : '')
  const [image, setImage] = useState(product?.image || '')
  const [imageSize, setImageSize] = useState(product?.imageSize ?? 100)
  const [imageError, setImageError] = useState('')
  const [description, setDescription] = useState(product?.description || '')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleImageChange = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageError('')
    try {
      setImage(await resizeImageFile(file))
    } catch {
      setImageError('Could not load that image — try a different file')
    }
  }

  const submit = async e => {
    e.preventDefault()
    if (!name.trim() || price === '') return
    setSubmitting(true)
    setSubmitError('')
    try {
      await onSubmit({
        name: name.trim(),
        price: parseFloat(price) || 0,
        costPrice: parseFloat(costPrice) || 0,
        category: category.trim() || 'Uncategorized',
        stock: parseInt(stock, 10) || 0,
        image,
        imageSize,
        description: description.trim(),
        kind: 'product',
      })
    } catch (err) {
      setSubmitError(err.message || `Could not ${isEdit ? 'save' : 'add'} product — try again`)
      setSubmitting(false)
    }
  }

  return (
    <Modal title={isEdit ? 'Edit Product' : 'Add Product'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Flat White" required />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Price (₱)</label>
            <input type="number" min="0" step="0.01" className={inputClass} value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" required />
          </div>
          <div>
            <label className={labelClass}>Cost (₱)</label>
            <input type="number" min="0" step="0.01" className={inputClass} value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={labelClass}>Stock</label>
            <input type="number" min="0" className={inputClass} value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
          </div>
        </div>
        <p className="text-xs text-[#a8977e] -mt-2">Cost is what this item costs you to make — used to calculate profit margin in Reports.</p>
        <div>
          <label className={labelClass}>Category</label>
          <input list="add-product-categories" className={inputClass} value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Coffee" />
          <datalist id="add-product-categories">
            {SUGGESTED_CATEGORIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className={labelClass}>Product Photo</label>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-[#fff9ea] border border-[#e8ddc8] flex items-center justify-center overflow-hidden shrink-0">
              {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">🍽️</span>}
            </div>
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#e8ddc8] text-sm text-[#7a6a50] hover:border-[#ddcca6] cursor-pointer transition-all">
                <IconUpload /> {image ? 'Change Photo' : 'Upload Photo'}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
              {image && (
                <button type="button" onClick={() => { setImage(''); setImageSize(100) }} className="text-xs text-[#b85c42] hover:text-[#a04030] transition-colors">
                  Remove
                </button>
              )}
            </div>
          </div>
          {imageError && <p className="text-xs text-[#b85c42] mt-1.5">{imageError}</p>}
        </div>
        {image && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelClass}>Image Size on Card</label>
              <span className="text-xs font-medium text-[#7a6a50]">{imageSize}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              step="5"
              value={imageSize}
              onChange={e => setImageSize(Number(e.target.value))}
              className="w-full accent-[#2c2416]"
            />
            <div className="flex justify-between text-[10px] text-[#a8977e] mt-1">
              <span>Small</span>
              <span>Medium</span>
              <span>Large</span>
            </div>
            <p className="text-xs text-[#a8977e] mt-3 mb-1.5">Card preview</p>
            <ProductImageBox
              image={image}
              imageSize={imageSize}
              alt="Preview"
              className="h-28 w-full rounded-xl border border-[#e8ddc8]"
            />
          </div>
        )}
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description" />
        </div>
        {submitError && <p className="text-xs text-[#b85c42]">{submitError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold hover:bg-[#3d3220] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {submitting && <Spinner className="w-4 h-4" />}
          {submitting ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Product')}
        </button>
      </form>
    </Modal>
  )
}

// ─── Add Product/Ingredient modal (Inventory screen) ───────────────────────
function AddInventoryItemModal({ onClose, onAdd, initialKind = 'product' }) {
  const [kind, setKind] = useState(initialKind)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState('')
  const [stock, setStock] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const submit = async e => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await onAdd({
        name: name.trim(),
        category: category.trim() || 'Uncategorized',
        stock: parseInt(stock, 10) || 0,
        kind,
        ...(kind === 'product'
          ? { price: parseFloat(price) || 0, description: '' }
          : { unit: unit.trim() || 'unit' }),
      })
    } catch (err) {
      setSubmitError(err.message || 'Could not save — try again')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Add Product / Ingredient" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind('product')}
              className={`py-2.5 rounded-xl text-sm font-medium transition-all ${kind === 'product' ? 'bg-[#2c2416] text-[#ddcca6]' : 'border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'}`}
            >
              Sellable Product
            </button>
            <button
              type="button"
              onClick={() => setKind('ingredient')}
              className={`py-2.5 rounded-xl text-sm font-medium transition-all ${kind === 'ingredient' ? 'bg-[#2c2416] text-[#ddcca6]' : 'border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'}`}
            >
              Raw Ingredient
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'product' ? 'e.g. Flat White' : 'e.g. Whole Milk'} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Category</label>
            <input list="add-inventory-categories" className={inputClass} value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Coffee" />
            <datalist id="add-inventory-categories">
              {SUGGESTED_CATEGORIES.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          {kind === 'product' ? (
            <div>
              <label className={labelClass}>Price (₱)</label>
              <input type="number" min="0" step="0.01" className={inputClass} value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" required />
            </div>
          ) : (
            <div>
              <label className={labelClass}>Unit</label>
              <input className={inputClass} value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, L, pcs" />
            </div>
          )}
        </div>
        <div>
          <label className={labelClass}>Starting Stock Quantity</label>
          <input type="number" min="0" className={inputClass} value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
        </div>
        {submitError && <p className="text-xs text-[#b85c42]">{submitError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold hover:bg-[#3d3220] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {submitting && <Spinner className="w-4 h-4" />}
          {submitting ? 'Adding…' : 'Add to Inventory'}
        </button>
      </form>
    </Modal>
  )
}

// ─── Dashboard Screen ───────────────────────────────────────────────────────
function Dashboard({ onNavigate, cart }) {
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    api.fetchRecentSales(7)
      .then(setSales)
      .catch(err => setError(err.message || 'Could not load dashboard data'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // Live sync: a sale rung up on another device shows up here without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-sales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        api.fetchRecentSales(7).then(setSales).catch(() => {})
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, () => {
        api.fetchRecentSales(7).then(setSales).catch(() => {})
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Keeps the greeting/date live if the dashboard is left open across a
  // morning/afternoon/evening boundary (or midnight) during a shift.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  const todaySales = sales.filter(e => isSameDay(new Date(e.created_at), now))
  const todayRevenue = todaySales.reduce((sum, e) => sum + e.total, 0)
  const todayOrders = todaySales.length
  const todayAvg = todayOrders > 0 ? todayRevenue / todayOrders : 0
  const todayCustomers = new Set(todaySales.map(e => e.customer_name || 'Walk-in')).size

  const stats = [
    {
      label: "Today's Revenue",
      value: formatPHP(todayRevenue),
      sub: todayOrders > 0 ? `From ${todayOrders} order${todayOrders !== 1 ? 's' : ''}` : 'No sales yet today',
    },
    {
      label: 'Orders',
      value: String(todayOrders),
      sub: todayOrders > 0 ? 'Completed today' : 'Waiting for first sale',
    },
    {
      label: 'Avg. Order',
      value: todayOrders > 0 ? formatPHP(todayAvg) : '—',
      sub: todayOrders > 0 ? 'Per completed sale' : 'No orders yet',
    },
    {
      label: 'Unique Customers',
      value: String(todayCustomers),
      sub: todayCustomers > 0 ? 'Served today' : 'None yet today',
    },
  ]

  const recentSales = [...todaySales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10)

  const hour = now.getHours()
  const timeGreeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening'
  const dateLabel = `${now.toLocaleDateString('en-US', { weekday: 'long' })}, ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'long' })} ${now.getFullYear()}`

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-[#a8977e] font-medium mb-1">{dateLabel}</p>
        <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl md:text-3xl font-semibold text-[#2c2416]">
          {timeGreeting}, Dimp'z Cafe
        </h1>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={() => onNavigate('products')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2c2416] text-[#ddcca6] text-sm font-medium hover:bg-[#3d3220] transition-colors"
        >
          <IconPlus /> New Order
        </button>
        <button
          onClick={() => onNavigate('checkout')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ddcca6] text-[#2c2416] text-sm font-medium hover:bg-[#c4ae88] transition-colors"
        >
          <IconCart /> Checkout {cart.length > 0 && <span className="bg-[#2c2416] text-[#ddcca6] text-xs rounded-full w-5 h-5 flex items-center justify-center">{cart.length}</span>}
        </button>
        <button
          onClick={() => onNavigate('inventory')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#e8ddc8] bg-white text-[#2c2416] text-sm font-medium hover:border-[#ddcca6] transition-colors"
        >
          <IconList /> Inventory
        </button>
        <button
          onClick={() => onNavigate('reports')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#e8ddc8] bg-white text-[#2c2416] text-sm font-medium hover:border-[#ddcca6] transition-colors"
        >
          <IconChart /> Reports
        </button>
      </div>

      {loading ? (
        <LoadingBlock label="Loading dashboard…" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((stat, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-[0_1px_12px_rgba(44,36,22,0.06)] border border-[#f0e8d8]">
                <p className="text-xs text-[#a8977e] font-medium uppercase tracking-wider mb-2">{stat.label}</p>
                <p style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl md:text-3xl font-semibold text-[#2c2416] mb-1">{stat.value}</p>
                <p className="text-xs text-[#a8977e]">{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* Revenue bar chart */}
          <div className="bg-white rounded-2xl p-5 md:p-6 shadow-[0_1px_12px_rgba(44,36,22,0.06)] border border-[#f0e8d8] mb-6">
            <div className="flex items-center justify-between mb-6">
              <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416]">Revenue — Last 7 Days</h2>
              <span className="text-xs text-[#a8977e] bg-[#fff9ea] px-3 py-1 rounded-full">
                {new Date(now.getTime() - 6 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{now.toLocaleDateString('en-US', { day: 'numeric' })}
              </span>
            </div>
            <WeeklyChart sales={sales} />
          </div>

          {/* Recent transactions */}
          <div className="bg-white rounded-2xl shadow-[0_1px_12px_rgba(44,36,22,0.06)] border border-[#f0e8d8] overflow-hidden">
            <div className="flex items-center justify-between p-5 md:p-6 border-b border-[#f0e8d8]">
              <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416]">Recent Transactions</h2>
              <button onClick={() => onNavigate('reports')} className="text-xs text-[#a8977e] hover:text-[#2c2416] transition-colors">View all →</button>
            </div>
            {recentSales.length === 0 ? (
              <div className="text-center py-16 text-[#a8977e]">
                <p className="text-4xl mb-3">◎</p>
                <p className="font-medium text-[#2c2416]">No sales yet today</p>
                <p className="text-sm mt-1">Completed orders will show up here</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f5edd6]">
                {recentSales.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between px-5 md:px-6 py-4 hover:bg-[#fffcf5] transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-xl bg-[#fff9ea] flex items-center justify-center text-[#a8977e] text-xs font-mono">{String(tx.id).slice(-2)}</div>
                      <div>
                        <p className="text-sm font-medium text-[#2c2416]">{tx.customer_name || 'Walk-in'}</p>
                        <p className="text-xs text-[#a8977e]">{tx.itemCount} item{tx.itemCount !== 1 ? 's' : ''} · {timeAgo(tx.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="hidden sm:inline text-xs px-2.5 py-1 rounded-full font-medium bg-[#f0faf0] text-[#6b9e72]">completed</span>
                      <span className="text-sm font-semibold text-[#2c2416]">{formatPHP(tx.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function WeeklyChart({ sales }) {
  const now = new Date()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() - (6 - i))
    return d
  })
  const data = days.map(d => ({
    day: d.toLocaleDateString('en-US', { weekday: 'short' }),
    val: sales.filter(e => isSameDay(new Date(e.created_at), d)).reduce((sum, e) => sum + e.total, 0),
  }))
  const max = Math.max(1, ...data.map(d => d.val))
  const hasData = data.some(d => d.val > 0)

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[#a8977e]">
        No sales recorded this week yet
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2 md:gap-3 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-2">
          <p className="text-xs text-[#a8977e] font-medium">{d.val >= 1000 ? `₱${(d.val / 1000).toFixed(1)}k` : formatPHP(d.val)}</p>
          <div className="w-full rounded-t-lg transition-all duration-700" style={{
            height: `${(d.val / max) * 80}px`,
            background: i === data.length - 1
              ? 'linear-gradient(to top, #c4ae88, #ddcca6)'
              : 'linear-gradient(to top, #ede3cc, #f5edd6)',
          }} />
          <p className="text-xs text-[#a8977e]">{d.day}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Product card options menu (kebab → Edit / Delete) ─────────────────────
function ProductCardMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className="absolute top-2 right-2 z-10">
      <button
        onClick={() => setOpen(o => !o)}
        title="Product options"
        className="w-7 h-7 rounded-full bg-white/90 border border-[#f0e8d8] flex items-center justify-center text-[#7a6a50] hover:bg-white hover:border-[#ddcca6] transition-all"
      >
        <IconKebab />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-32 bg-white rounded-xl border border-[#f0e8d8] shadow-lg py-1 overflow-hidden">
          <button
            onClick={() => { setOpen(false); onEdit() }}
            className="w-full text-left px-3.5 py-2 text-sm text-[#2c2416] hover:bg-[#fff9ea] transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => { setOpen(false); onDelete() }}
            className="w-full text-left px-3.5 py-2 text-sm text-[#b85c42] hover:bg-[#fdf0ec] transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Persistent cart sidebar (Products screen, lg+ only) ───────────────────
function CartSidebar({ cart, onUpdateQty, onRemove, onCheckout }) {
  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return (
    <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_12px_rgba(44,36,22,0.06)] sticky top-4 flex flex-col max-h-[calc(100vh-2rem)]">
      <div className="px-5 py-4 border-b border-[#f5edd6] shrink-0">
        <h2 className="font-semibold text-[#2c2416]">Your Order</h2>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#f5edd6]">
        {cart.map(item => (
          <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
            <ProductImageBox image={item.image} imageSize={item.imageSize} alt={item.name} className="w-10 h-10 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#2c2416] truncate">{item.name}</p>
              <p className="text-xs text-[#a8977e]">{formatPHP(item.price)} each</p>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => onUpdateQty(item.id, -1)}
                  className="w-6 h-6 rounded-lg border border-[#e8ddc8] flex items-center justify-center text-[#7a6a50] hover:border-[#ddcca6] hover:bg-[#fff9ea] transition-all"
                >
                  <IconMinus />
                </button>
                <span className="w-5 text-center text-xs font-semibold text-[#2c2416]">{item.quantity}</span>
                <button
                  onClick={() => onUpdateQty(item.id, 1)}
                  className="w-6 h-6 rounded-lg border border-[#e8ddc8] flex items-center justify-center text-[#7a6a50] hover:border-[#ddcca6] hover:bg-[#fff9ea] transition-all"
                >
                  <IconPlus />
                </button>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className="text-sm font-semibold text-[#2c2416]">{formatPHP(item.price * item.quantity)}</span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-[#c4ae88] hover:text-[#b85c42] transition-colors"
              >
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-4 border-t border-[#f5edd6] shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#7a6a50]">Total</span>
          <span style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416]">{formatPHP(total)}</span>
        </div>
        <button
          onClick={onCheckout}
          className="w-full py-3 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold hover:bg-[#3d3220] transition-colors"
        >
          Checkout
        </button>
      </div>
    </div>
  )
}

// ─── Products Screen ─────────────────────────────────────────────────────────
function Products({ items, itemsLoading, itemsError, onRetryItems, onAddItem, onUpdateItem, onDeleteItem, onAddToCart, onUpdateQty, onRemove, cart, onNavigate }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDeleteItem(confirmDelete.id)
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(err.message || 'Could not remove product — try again')
    } finally {
      setDeleting(false)
    }
  }

  const products = items.filter(i => i.kind === 'product')
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))]

  const filtered = products.filter(p => {
    const matchCat = category === 'All' || p.category === category
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416]">Product Catalog</h1>
          <p className="text-sm text-[#a8977e] mt-0.5">{products.length} item{products.length !== 1 ? 's' : ''} available</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2c2416] text-[#ddcca6] text-sm font-medium hover:bg-[#3d3220] transition-colors"
          >
            <IconPlus /> Add Product
          </button>
          {cartCount > 0 && (
            <button
              onClick={() => onNavigate('checkout')}
              className="lg:hidden flex items-center gap-2 px-4 py-2 rounded-xl bg-[#ddcca6] text-[#2c2416] text-sm font-medium hover:bg-[#c4ae88] transition-colors"
            >
              <IconCart />
              <span>View Cart</span>
              <span className="bg-[#2c2416] text-[#ddcca6] text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{cartCount}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
      {itemsLoading ? (
        <LoadingBlock label="Loading products…" />
      ) : itemsError ? (
        <ErrorBlock message={itemsError} onRetry={onRetryItems} />
      ) : products.length === 0 ? (
        <div className="text-center py-20 text-[#a8977e] bg-white rounded-2xl border border-[#f0e8d8]">
          <p className="text-4xl mb-3">◈</p>
          <p className="font-medium text-[#2c2416]">No products yet — add your first product</p>
          <p className="text-sm mt-1 mb-5">Build your catalog to start taking orders</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2c2416] text-[#ddcca6] text-sm font-medium hover:bg-[#3d3220] transition-colors"
          >
            <IconPlus /> Add Product
          </button>
        </div>
      ) : (
        <>
          {/* Search + filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a8977e]"><IconSearch /></span>
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#e8ddc8] bg-white text-sm text-[#2c2416] placeholder-[#c4ae88] focus:outline-none focus:border-[#ddcca6] focus:ring-2 focus:ring-[#ddcca6]/20 transition-all"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`shrink-0 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    category === cat
                      ? 'bg-[#2c2416] text-[#ddcca6]'
                      : 'bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(product => {
              const inCart = cart.find(i => i.id === product.id)
              const lowStock = product.stock < 15
              return (
                <div
                  key={product.id}
                  className="relative bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)] overflow-hidden hover:shadow-[0_4px_20px_rgba(44,36,22,0.10)] hover:-translate-y-0.5 transition-all duration-200"
                >
                  <ProductCardMenu
                    onEdit={() => setEditingProduct(product)}
                    onDelete={() => { setConfirmDelete(product); setDeleteError('') }}
                  />
                  <ProductImageBox image={product.image} imageSize={product.imageSize} alt={product.name} className="h-24" />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <p className="text-sm font-semibold text-[#2c2416] leading-snug">{product.name}</p>
                      {lowStock && (
                        <span className="shrink-0 text-[10px] bg-[#fdf0ec] text-[#b85c42] px-1.5 py-0.5 rounded-full font-medium">Low</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#a8977e] mb-3 leading-snug line-clamp-2">{product.description}</p>
                    <div className="flex items-center justify-between">
                      <span style={{ fontFamily: 'var(--font-serif)' }} className="text-base font-semibold text-[#2c2416]">{formatPHP(product.price)}</span>
                      <button
                        onClick={() => onAddToCart(product)}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          inCart
                            ? 'bg-[#ddcca6] text-[#2c2416]'
                            : 'bg-[#2c2416] text-[#ddcca6] hover:bg-[#3d3220]'
                        }`}
                      >
                        {inCart ? `× ${inCart.quantity}` : <><IconPlus /> Add</>}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-[#a8977e]">
              <p className="text-4xl mb-3">◎</p>
              <p className="font-medium">No products found</p>
              <p className="text-sm mt-1">Try a different search or category</p>
            </div>
          )}
        </>
      )}
      </div>

      {cart.length > 0 && (
        <div className="hidden lg:block lg:w-80 xl:w-96 shrink-0">
          <CartSidebar cart={cart} onUpdateQty={onUpdateQty} onRemove={onRemove} onCheckout={() => onNavigate('checkout')} />
        </div>
      )}
      </div>

      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onSubmit={async item => { await onAddItem(item); setShowAddModal(false) }}
        />
      )}

      {editingProduct && (
        <AddProductModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSubmit={async item => { await onUpdateItem(editingProduct.id, item); setEditingProduct(null) }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove Product"
          message={`Remove "${confirmDelete.name}" from your catalog? This can't be undone.`}
          onConfirm={handleDelete}
          onCancel={() => { setConfirmDelete(null); setDeleteError('') }}
          loading={deleting}
          error={deleteError}
        />
      )}
    </div>
  )
}

// ─── Receipt (print-only — hidden on screen, see .receipt-print in index.css) ─
function Receipt({ businessName, saleId, createdAt, customerName, items, subtotal, total, paymentMethod }) {
  const paymentLabel = paymentMethod === 'card' ? 'Card' : paymentMethod === 'cash' ? 'Cash' : 'GCash'
  return (
    <div className="receipt-print font-mono text-black bg-white text-[11px] leading-snug w-[80mm] mx-auto p-3">
      <div className="text-center mb-2">
        <p className="font-bold text-sm uppercase tracking-wide">{businessName}</p>
        <p>{new Date(createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <p>Order #{String(saleId || '').slice(0, 8).toUpperCase()}</p>
      </div>
      <div className="border-t border-dashed border-black my-1.5" />
      <p>Customer: {customerName || 'Walk-in'}</p>
      <div className="border-t border-dashed border-black my-1.5" />
      {items.map((item, i) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="flex-1 truncate">{item.name}</span>
            <span className="shrink-0">{formatPHP(item.price * item.qty)}</span>
          </div>
          <p className="text-[10px]">{item.qty} x {formatPHP(item.price)}</p>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-1.5" />
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatPHP(subtotal)}</span>
      </div>
      <div className="flex justify-between font-bold text-sm mt-1">
        <span>TOTAL</span>
        <span>{formatPHP(total)}</span>
      </div>
      <div className="flex justify-between mt-1">
        <span>Payment</span>
        <span>{paymentLabel}</span>
      </div>
      <div className="border-t border-dashed border-black my-2" />
      <p className="text-center">Thank you for your purchase!</p>
      <p className="text-center text-[10px]">Please come again</p>
    </div>
  )
}

// ─── Checkout Screen ──────────────────────────────────────────────────────────
function Checkout({ cart, onUpdateQty, onRemove, onClearCart, onCharge, businessName, receiptPrintingEnabled }) {
  const [customerName, setCustomerName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [paid, setPaid] = useState(false)
  const [charging, setCharging] = useState(false)
  const [chargeError, setChargeError] = useState('')
  const [completedSale, setCompletedSale] = useState(null)

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const total = subtotal

  const handleCharge = async () => {
    setCharging(true)
    setChargeError('')
    const resolvedCustomerName = customerName.trim() || 'Walk-in'
    try {
      const sale = await onCharge({
        customerName: resolvedCustomerName,
        items: cart.map(i => ({ id: i.id, name: i.name, qty: i.quantity, price: i.price, category: i.category })),
        total,
        paymentMethod,
      })
      setCompletedSale({
        id: sale?.id,
        createdAt: sale?.created_at || new Date().toISOString(),
        customerName: resolvedCustomerName,
        items: cart.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
        subtotal,
        total,
        paymentMethod,
      })
      setPaid(true)
    } catch (err) {
      setChargeError(err.message || 'Payment could not be recorded — try again')
    } finally {
      setCharging(false)
    }
  }

  // Auto-print when the success screen appears, if the Settings toggle is on.
  useEffect(() => {
    if (paid && completedSale && receiptPrintingEnabled) {
      window.print()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid])

  if (paid) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-[#f0faf0] flex items-center justify-center text-4xl mb-5">✓</div>
        <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416] mb-2">Payment Successful</h2>
        <p className="text-[#a8977e] mb-1">Total charged: <strong className="text-[#2c2416]">{formatPHP(total)}</strong></p>
        <p className="text-[#a8977e] mb-1">Customer: <strong className="text-[#2c2416]">{customerName.trim() || 'Walk-in'}</strong></p>
        <p className="text-sm text-[#a8977e] mb-8">via {paymentMethod === 'card' ? 'Credit/Debit Card' : paymentMethod === 'cash' ? 'Cash' : 'GCash'}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="px-6 py-3 rounded-xl border border-[#e8ddc8] text-[#7a6a50] font-medium hover:border-[#ddcca6] hover:bg-[#fff9ea] transition-colors"
          >
            Print Receipt
          </button>
          <button
            onClick={() => { onClearCart(); setPaid(false); setCustomerName(''); setCompletedSale(null) }}
            className="px-8 py-3 rounded-xl bg-[#2c2416] text-[#ddcca6] font-medium hover:bg-[#3d3220] transition-colors"
          >
            New Order
          </button>
        </div>
        {completedSale && (
          <Receipt
            businessName={businessName}
            saleId={completedSale.id}
            createdAt={completedSale.createdAt}
            customerName={completedSale.customerName}
            items={completedSale.items}
            subtotal={completedSale.subtotal}
            total={completedSale.total}
            paymentMethod={completedSale.paymentMethod}
          />
        )}
      </div>
    )
  }

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="text-6xl mb-4">🛒</div>
        <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-xl font-semibold text-[#2c2416] mb-2">Cart is empty</h2>
        <p className="text-[#a8977e] text-sm">Add products to get started</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416] mb-6">Checkout</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Cart items */}
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_12px_rgba(44,36,22,0.06)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f5edd6]">
              <h2 className="font-semibold text-[#2c2416]">Order Items</h2>
              <button onClick={onClearCart} className="text-xs text-[#b85c42] hover:text-[#a04030] transition-colors">Clear all</button>
            </div>
            <div className="divide-y divide-[#f5edd6]">
              {cart.map(item => (
                <div key={item.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl bg-[#fff9ea] flex items-center justify-center text-xl shrink-0 overflow-hidden">
                    {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" /> : '🍽️'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#2c2416] truncate">{item.name}</p>
                    <p className="text-xs text-[#a8977e]">{formatPHP(item.price)} each</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onUpdateQty(item.id, -1)}
                      className="w-7 h-7 rounded-lg border border-[#e8ddc8] flex items-center justify-center text-[#7a6a50] hover:border-[#ddcca6] hover:bg-[#fff9ea] transition-all"
                    >
                      <IconMinus />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold text-[#2c2416]">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQty(item.id, 1)}
                      className="w-7 h-7 rounded-lg border border-[#e8ddc8] flex items-center justify-center text-[#7a6a50] hover:border-[#ddcca6] hover:bg-[#fff9ea] transition-all"
                    >
                      <IconPlus />
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold text-[#2c2416] shrink-0">{formatPHP(item.price * item.quantity)}</span>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="text-[#c4ae88] hover:text-[#b85c42] transition-colors ml-1 shrink-0"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Order summary */}
        <div className="lg:w-80 xl:w-96 shrink-0">
          <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_12px_rgba(44,36,22,0.06)] p-5 sticky top-4">
            <h2 className="font-semibold text-[#2c2416] mb-4">Order Summary</h2>

            {/* Customer name */}
            <div className="mb-4">
              <p className={labelClass}>Customer Name</p>
              <input
                type="text"
                placeholder="Walk-in customer"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Totals */}
            <div className="space-y-2.5 py-4 border-t border-b border-[#f5edd6] mb-4">
              <div className="flex justify-between text-sm text-[#7a6a50]">
                <span>Subtotal ({cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>{formatPHP(subtotal)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[#2c2416]">
                <span>Total</span>
                <span style={{ fontFamily: 'var(--font-serif)' }} className="text-lg">{formatPHP(total)}</span>
              </div>
            </div>

            {/* Payment method */}
            <div className="mb-5">
              <p className="text-xs text-[#a8977e] font-medium mb-2">Payment Method</p>
              <div className="grid grid-cols-3 gap-2">
                {['card', 'cash', 'gcash'].map(method => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2.5 rounded-xl text-xs font-medium transition-all ${
                      paymentMethod === method
                        ? 'bg-[#2c2416] text-[#ddcca6]'
                        : 'border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'
                    }`}
                  >
                    {method === 'card' ? '💳 Card' : method === 'cash' ? '💵 Cash' : '📱 GCash'}
                  </button>
                ))}
              </div>
            </div>

            {chargeError && <p className="text-xs text-[#b85c42] mb-3 text-center">{chargeError}</p>}

            {/* Charge button */}
            <button
              onClick={handleCharge}
              disabled={charging}
              className="w-full py-4 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold text-base hover:bg-[#3d3220] active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {charging && <Spinner className="w-4 h-4" />}
              {charging ? 'Processing…' : `Charge ${formatPHP(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Inventory Screen ─────────────────────────────────────────────────────────
function Inventory({ items, itemsLoading, itemsError, onRetryItems, onAddItem, onUpdateStock, onDeleteItem }) {
  const [tab, setTab] = useState('product')
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [savingStock, setSavingStock] = useState(false)
  const [stockError, setStockError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const tabItems = items.filter(i => i.kind === tab)
  const tabLabel = tab === 'product' ? 'Product' : 'Ingredient'

  const save = async id => {
    const val = parseInt(editVal, 10)
    if (isNaN(val) || val < 0) { setEditing(null); return }
    setSavingStock(true)
    setStockError('')
    try {
      await onUpdateStock(id, val)
      setEditing(null)
    } catch (err) {
      setStockError(err.message || 'Could not update stock — try again')
    } finally {
      setSavingStock(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDeleteItem(confirmDelete.id)
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(err.message || 'Could not remove item — try again')
    } finally {
      setDeleting(false)
    }
  }

  const lowStockCount = tabItems.filter(i => i.stock < 15).length

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416]">Inventory</h1>
          <p className="text-sm text-[#a8977e] mt-0.5">{tabItems.length} item{tabItems.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <div className="flex items-center gap-3">
          {tabItems.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-[#b85c42] bg-[#fdf0ec] px-3 py-1.5 rounded-full">
              ⚠ {lowStockCount} low stock
            </span>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2c2416] text-[#ddcca6] text-sm font-medium hover:bg-[#3d3220] transition-colors"
          >
            <IconPlus /> Add {tabLabel}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('product')}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            tab === 'product'
              ? 'bg-[#2c2416] text-[#ddcca6]'
              : 'bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'
          }`}
        >
          Products
        </button>
        <button
          onClick={() => setTab('ingredient')}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
            tab === 'ingredient'
              ? 'bg-[#2c2416] text-[#ddcca6]'
              : 'bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6]'
          }`}
        >
          Ingredients
        </button>
      </div>

      {stockError && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-[#fdf0ec] border border-[#f3d9d0] text-sm text-[#b85c42]">{stockError}</div>
      )}

      {itemsLoading ? (
        <LoadingBlock label="Loading inventory…" />
      ) : itemsError ? (
        <ErrorBlock message={itemsError} onRetry={onRetryItems} />
      ) : tabItems.length === 0 ? (
        <div className="text-center py-20 text-[#a8977e] bg-white rounded-2xl border border-[#f0e8d8]">
          <p className="text-4xl mb-3">≡</p>
          <p className="font-medium text-[#2c2416]">No {tabLabel.toLowerCase()}s yet — add your first one</p>
          <p className="text-sm mt-1 mb-5">Track what's on hand as soon as you add it</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2c2416] text-[#ddcca6] text-sm font-medium hover:bg-[#3d3220] transition-colors"
          >
            <IconPlus /> Add {tabLabel}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_12px_rgba(44,36,22,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f0e8d8] bg-[#fffcf5]">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider hidden sm:table-cell">Category</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider hidden md:table-cell">Price / Unit</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider">Stock</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider">Status</th>
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-[#a8977e] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5edd6]">
                {tabItems.map(p => {
                  const status = p.stock === 0 ? 'out' : p.stock < 15 ? 'low' : 'ok'
                  return (
                    <tr key={p.id} className="hover:bg-[#fffcf5] transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {p.kind === 'ingredient' ? (
                            <span className="text-xl">🧂</span>
                          ) : p.image ? (
                            <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                              <img src={p.image} alt="" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <span className="text-xl">🍽️</span>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-[#2c2416]">{p.name}</p>
                              {p.kind === 'ingredient' && (
                                <span className="text-[9px] uppercase tracking-wide bg-[#fff9ea] text-[#a8977e] px-1.5 py-0.5 rounded-full">Ingredient</span>
                              )}
                            </div>
                            <p className="text-xs text-[#a8977e] sm:hidden">{p.category}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 hidden sm:table-cell">
                        <span className="text-sm text-[#7a6a50] bg-[#fff9ea] px-2.5 py-1 rounded-lg">{p.category}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#2c2416] font-medium hidden md:table-cell">
                        {p.kind === 'product' ? formatPHP(p.price) : (p.unit || '—')}
                      </td>
                      <td className="px-5 py-4">
                        {editing === p.id ? (
                          <input
                            type="number"
                            value={editVal}
                            disabled={savingStock}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={() => save(p.id)}
                            onKeyDown={e => e.key === 'Enter' && save(p.id)}
                            className="w-20 px-2 py-1 rounded-lg border border-[#ddcca6] text-sm text-[#2c2416] focus:outline-none disabled:opacity-60"
                            autoFocus
                          />
                        ) : (
                          <span className="text-sm font-semibold text-[#2c2416]">{p.stock}</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          status === 'ok' ? 'bg-[#f0faf0] text-[#6b9e72]' :
                          status === 'low' ? 'bg-[#fff8e6] text-[#c49a3c]' :
                          'bg-[#fdf0ec] text-[#b85c42]'
                        }`}>
                          {status === 'ok' ? 'In Stock' : status === 'low' ? 'Low Stock' : 'Out of Stock'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setEditing(p.id); setEditVal(String(p.stock)) }}
                            className="text-xs text-[#7a6a50] hover:text-[#2c2416] border border-[#e8ddc8] hover:border-[#ddcca6] px-3 py-1.5 rounded-lg transition-all"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setConfirmDelete(p); setDeleteError('') }}
                            title="Remove item"
                            className="text-xs text-[#b85c42] hover:text-[#a04030] border border-[#e8ddc8] hover:border-[#b85c42] px-3 py-1.5 rounded-lg transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddInventoryItemModal
          initialKind={tab}
          onClose={() => setShowAddModal(false)}
          onAdd={async item => { await onAddItem(item); setShowAddModal(false) }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${confirmDelete.kind === 'ingredient' ? 'Ingredient' : 'Product'}`}
          message={`Remove "${confirmDelete.name}" from inventory? This can't be undone.`}
          onConfirm={handleDelete}
          onCancel={() => { setConfirmDelete(null); setDeleteError('') }}
          loading={deleting}
          error={deleteError}
        />
      )}
    </div>
  )
}

// ─── Customers Screen ─────────────────────────────────────────────────────────
function Customers() {
  const [search, setSearch] = useState('')
  const customers = []
  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  const tierColor = tier =>
    tier === 'Gold' ? 'bg-[#fff8e6] text-[#c49a3c]' :
    tier === 'Silver' ? 'bg-[#f5f5f5] text-[#7a7a7a]' :
    'bg-[#fdf0ec] text-[#b85c42]'

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416]">Customers</h1>
          <p className="text-sm text-[#a8977e] mt-0.5">{customers.length} registered customers</p>
        </div>
        <div className="relative w-full sm:w-64">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a8977e]"><IconSearch /></span>
          <input
            type="text"
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#e8ddc8] bg-white text-sm placeholder-[#c4ae88] focus:outline-none focus:border-[#ddcca6] focus:ring-2 focus:ring-[#ddcca6]/20 transition-all"
          />
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-20 text-[#a8977e] bg-white rounded-2xl border border-[#f0e8d8]">
          <p className="text-4xl mb-3">◉</p>
          <p className="font-medium text-[#2c2416]">No customers yet</p>
          <p className="text-sm mt-1">Customer profiles will show up here once you have them</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className="bg-white rounded-2xl border border-[#f0e8d8] p-5 shadow-[0_1px_8px_rgba(44,36,22,0.05)] hover:shadow-[0_4px_20px_rgba(44,36,22,0.10)] hover:-translate-y-0.5 transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#fff9ea] border border-[#e8ddc8] flex items-center justify-center text-lg font-semibold text-[#7a6a50]">
                    {c.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#2c2416]">{c.name}</p>
                    <p className="text-xs text-[#a8977e]">Last visit: {c.lastVisit}</p>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tierColor(c.tier)}`}>{c.tier}</span>
              </div>
              <div className="space-y-1.5 text-xs text-[#7a6a50] mb-4">
                <p>{c.email}</p>
                <p>{c.phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#f5edd6]">
                <div>
                  <p className="text-xs text-[#a8977e]">Total Orders</p>
                  <p className="font-semibold text-[#2c2416]">{c.totalOrders}</p>
                </div>
                <div>
                  <p className="text-xs text-[#a8977e]">Total Spent</p>
                  <p className="font-semibold text-[#2c2416]">{formatPHP(c.totalSpent)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Report exports (Excel / PDF / Word) ───────────────────────────────────
function paymentLabel(method) {
  return method === 'card' ? 'Card' : method === 'cash' ? 'Cash' : method === 'gcash' ? 'GCash' : (method || '—')
}

function exportSalesToExcel(sales, businessName) {
  const rows = sales.map(s => ({
    'Order ID': String(s.id).slice(0, 8).toUpperCase(),
    Date: new Date(s.created_at).toLocaleString('en-PH'),
    Customer: s.customer_name || 'Walk-in',
    'Payment Method': paymentLabel(s.payment_method),
    Total: s.total,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
  XLSX.writeFile(wb, `${businessName || 'transactions'}-report-${Date.now()}.xlsx`)
}

function exportSalesToPDF(sales, businessName, summary) {
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(`${businessName || 'Transaction Report'}`, 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(120, 106, 80)
  doc.text(`Generated ${new Date().toLocaleString('en-PH')} — ${sales.length} transaction${sales.length !== 1 ? 's' : ''}`, 14, 25)
  doc.setTextColor(44, 36, 22)
  doc.setFontSize(11)
  doc.text(
    `Total Revenue: ${formatPHP(summary.totalRevenue)}    Net Profit: ${formatPHP(summary.netProfit)}    Margin: ${summary.margin.toFixed(1)}%`,
    14, 33
  )
  autoTable(doc, {
    startY: 40,
    head: [['Date', 'Customer', 'Payment', 'Total']],
    body: sales.map(s => [
      new Date(s.created_at).toLocaleDateString('en-PH'),
      s.customer_name || 'Walk-in',
      paymentLabel(s.payment_method),
      formatPHP(s.total),
    ]),
    headStyles: { fillColor: [44, 36, 22] },
    styles: { fontSize: 9 },
  })
  doc.save(`${businessName || 'transactions'}-report-${Date.now()}.pdf`)
}

async function exportSalesToWord(sales, businessName, summary) {
  const headerRow = new TableRow({
    children: ['Date', 'Customer', 'Payment', 'Total'].map(h =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
    ),
  })
  const dataRows = sales.map(s => new TableRow({
    children: [
      new Paragraph(new Date(s.created_at).toLocaleDateString('en-PH')),
      new Paragraph(s.customer_name || 'Walk-in'),
      new Paragraph(paymentLabel(s.payment_method)),
      new Paragraph(formatPHP(s.total)),
    ].map(p => new TableCell({ children: [p] })),
  }))

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: businessName || 'Transaction Report', heading: HeadingLevel.HEADING1 }),
        new Paragraph({ text: `Generated ${new Date().toLocaleString('en-PH')} — ${sales.length} transaction${sales.length !== 1 ? 's' : ''}` }),
        new Paragraph({ text: `Total Revenue: ${formatPHP(summary.totalRevenue)}   Net Profit: ${formatPHP(summary.netProfit)}   Margin: ${summary.margin.toFixed(1)}%` }),
        new Paragraph({ text: '' }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }),
      ],
    }],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${businessName || 'transactions'}-report-${Date.now()}.docx`)
}

// ─── Reports Screen ───────────────────────────────────────────────────────────
function Reports({ items, businessName }) {
  const [sales, setSales] = useState([])
  const [saleItems, setSaleItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const now = new Date()

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([api.fetchAllSales(), api.fetchAllSaleItemsWithCategory()])
      .then(([salesRows, itemRows]) => {
        setSales(salesRows)
        setSaleItems(itemRows)
      })
      .catch(err => setError(err.message || 'Could not load reports'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // Live sync: reports reflect sales rung up elsewhere without a refresh
  // (silent — no loading flash for updates after the initial load).
  useEffect(() => {
    const silentReload = () => {
      Promise.all([api.fetchAllSales(), api.fetchAllSaleItemsWithCategory()])
        .then(([salesRows, itemRows]) => {
          setSales(salesRows)
          setSaleItems(itemRows)
        })
        .catch(() => {})
    }
    const channel = supabase
      .channel('reports-sales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, silentReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, silentReload)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Top products — aggregated from real sale line items
  const productMap = new Map()
  saleItems.forEach(item => {
    const entry = productMap.get(item.name) || { name: item.name, sales: 0, revenue: 0 }
    entry.sales += item.qty
    entry.revenue += item.price * item.qty
    productMap.set(item.name, entry)
  })
  const topProducts = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  const maxSales = Math.max(1, ...topProducts.map(p => p.sales))

  // Monthly revenue — last 6 months (including current), from real sale dates
  const months = Array.from({ length: 6 }, (_, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1)
    return { key: monthKey(d), label: d.toLocaleDateString('en-US', { month: 'short' }) }
  })
  const revenueByMonth = {}
  sales.forEach(sale => {
    const key = monthKey(new Date(sale.created_at))
    revenueByMonth[key] = (revenueByMonth[key] || 0) + sale.total
  })
  const monthly = months.map(m => ({ month: m.label, revenue: revenueByMonth[m.key] || 0 }))
  const maxM = Math.max(1, ...monthly.map(m => m.revenue))
  const hasMonthlyData = monthly.some(m => m.revenue > 0)

  // Category breakdown — % of revenue per category from actual sale line items
  const categoryRevenue = new Map()
  let totalCategoryRevenue = 0
  saleItems.forEach(item => {
    const cat = item.category || 'Uncategorized'
    const rev = item.price * item.qty
    categoryRevenue.set(cat, (categoryRevenue.get(cat) || 0) + rev)
    totalCategoryRevenue += rev
  })
  const categoryBreakdown = Array.from(categoryRevenue.entries())
    .map(([cat, revenue]) => ({ cat, revenue, pct: totalCategoryRevenue ? Math.round((revenue / totalCategoryRevenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)

  // All-time transaction stats + COGS/profit — the new "Transaction Reports" header section
  const totalTransactionCount = sales.length
  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0)
  const avgOrderValue = totalTransactionCount ? totalRevenue / totalTransactionCount : 0
  const totalDrinksQty = saleItems.filter(i => DRINK_CATEGORIES.has(i.category)).reduce((sum, i) => sum + i.qty, 0)
  const totalPastryFoodQty = saleItems.filter(i => PASTRY_FOOD_CATEGORIES.has(i.category)).reduce((sum, i) => sum + i.qty, 0)
  const totalCOGS = saleItems.reduce((sum, i) => sum + i.cost * i.qty, 0)
  const netProfit = totalRevenue - totalCOGS
  const profitMargin = totalRevenue ? (netProfit / totalRevenue) * 100 : 0
  const cogsSummary = { totalRevenue, netProfit, margin: profitMargin }

  if (loading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416]">Reports</h1>
          <p className="text-sm text-[#a8977e] mt-0.5">Business performance overview</p>
        </div>
        <LoadingBlock label="Loading reports…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416]">Reports</h1>
          <p className="text-sm text-[#a8977e] mt-0.5">Business performance overview</p>
        </div>
        <ErrorBlock message={error} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <span className="inline-block text-[10px] font-bold uppercase tracking-widest bg-[#ddcca6] text-[#2c2416] px-3 py-1 rounded-full mb-2">
            Performance
          </span>
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-3xl md:text-4xl font-bold uppercase text-[#2c2416] leading-tight">
            Transaction Reports
          </h1>
          <div className="w-14 h-1 rounded-full bg-[#c4ae88] mt-3" />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={load}
            title="Reload the latest transaction data"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-[#fdf0ec] text-[#b85c42] hover:bg-[#f9e2db] transition-colors"
          >
            <IconRefresh /> Clear ({totalTransactionCount})
          </button>
          <button
            onClick={() => exportSalesToExcel(sales, businessName)}
            disabled={sales.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6] transition-colors disabled:opacity-50"
          >
            <IconTable /> Excel
          </button>
          <button
            onClick={() => exportSalesToPDF(sales, businessName, cogsSummary)}
            disabled={sales.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6] transition-colors disabled:opacity-50"
          >
            <IconFileText /> PDF
          </button>
          <button
            onClick={() => exportSalesToWord(sales, businessName, cogsSummary)}
            disabled={sales.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-white border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6] transition-colors disabled:opacity-50"
          >
            <IconDownload /> Word
          </button>
        </div>
      </div>

      {/* Transaction stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Transaction Count', value: String(totalTransactionCount), icon: '🧾' },
          { label: 'Avg Order Value', value: formatPHP(avgOrderValue), icon: '💵' },
          { label: 'Total Drinks Qty', value: String(totalDrinksQty), icon: '☕' },
          { label: 'Total Pastry/Food Qty', value: String(totalPastryFoodQty), icon: '🥐' },
          { label: 'Total Revenue', value: formatPHP(totalRevenue), icon: '📈' },
        ].map((stat, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8977e]">{stat.label}</p>
              <span className="text-lg shrink-0">{stat.icon}</span>
            </div>
            <p style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-bold text-[#2c2416]">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Profitability & COGS analysis */}
      <div className="bg-[#fff9ea] border border-[#ecdfc0] rounded-2xl p-5 md:p-6 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#a8783c] mb-1.5">
              📊 Profitability &amp; COGS Analysis
            </span>
            <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416]">Real Net Profit Comparison</h2>
            <p className="text-xs text-[#a8977e] mt-1 max-w-md">
              Compare total sales against product costing (COGS) to calculate your true business earnings.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="text-center bg-white/70 rounded-xl px-3 py-4 border border-[#ecdfc0]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8977e] mb-1.5">Total Sales</p>
            <p style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-bold text-[#2c2416]">{formatPHP(totalRevenue)}</p>
          </div>
          <div className="text-center bg-white/70 rounded-xl px-3 py-4 border border-[#ecdfc0]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8977e] mb-1.5">Total Cost (COGS)</p>
            <p style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-bold text-[#b85c42]">{formatPHP(totalCOGS)}</p>
          </div>
          <div className="text-center bg-white/70 rounded-xl px-3 py-4 border border-[#ecdfc0]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8977e] mb-1.5">Net Profit</p>
            <p style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-bold text-[#6b9e72]">{formatPHP(netProfit)}</p>
          </div>
          <div className="text-center bg-white/70 rounded-xl px-3 py-4 border border-[#ecdfc0]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8977e] mb-1.5">Profit Margin</p>
            <p style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-bold text-[#c49a3c]">{profitMargin.toFixed(1)}%</p>
          </div>
        </div>
        {totalCOGS === 0 && (
          <p className="text-xs text-[#a8783c] mt-4">
            No product cost data entered yet — Net Profit currently equals Total Sales. Add a Cost price to your products (Edit Product) for accurate COGS and margin.
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Monthly revenue */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)]">
          <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416] mb-6">Monthly Revenue</h2>
          {hasMonthlyData ? (
            <div className="flex items-end gap-2 h-36">
              {monthly.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <p className="text-[10px] text-[#a8977e]">{m.revenue >= 1000 ? `₱${(m.revenue / 1000).toFixed(1)}k` : formatPHP(m.revenue)}</p>
                  <div
                    className="w-full rounded-t-lg"
                    style={{
                      height: `${(m.revenue / maxM) * 100}px`,
                      background: i === monthly.length - 1
                        ? 'linear-gradient(to top, #c4ae88, #ddcca6)'
                        : 'linear-gradient(to top, #ede3cc, #f5edd6)',
                    }}
                  />
                  <p className="text-[10px] text-[#a8977e]">{m.month}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-36 text-sm text-[#a8977e]">No revenue recorded yet</div>
          )}
        </div>

        {/* Top products */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)]">
          <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416] mb-5">Top Products</h2>
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-[#a8977e]">
              <p className="text-3xl mb-2">◈</p>
              <p className="text-sm font-medium text-[#2c2416]">No sales yet</p>
              <p className="text-xs mt-1">Top sellers will show up here once you make a sale</p>
            </div>
          ) : (
            <div className="space-y-4">
              {topProducts.map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#a8977e] w-4">{i + 1}.</span>
                      <span className="text-sm font-medium text-[#2c2416]">{p.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-[#2c2416]">{formatPHP(p.revenue)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#f5edd6] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(p.sales / maxSales) * 100}%`,
                        background: i === 0 ? '#c4ae88' : '#e8ddc8',
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#a8977e] mt-1">{p.sales} sold</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="mt-6 bg-white rounded-2xl p-5 md:p-6 border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)]">
        <h2 style={{ fontFamily: 'var(--font-serif)' }} className="text-lg font-semibold text-[#2c2416] mb-5">Category Breakdown</h2>
        {categoryBreakdown.length === 0 ? (
          <div className="text-center py-8 text-[#a8977e]">
            <p className="text-sm">No category data yet — sell a product to see the breakdown</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {categoryBreakdown.map((c, i) => (
              <div key={c.cat} className="text-center p-4 rounded-xl bg-[#fffcf5] border border-[#f0e8d8]">
                <div className="relative w-16 h-16 mx-auto mb-3">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f0e8d8" strokeWidth="3.8" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} strokeWidth="3.8"
                      strokeDasharray={`${c.pct} ${100 - c.pct}`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#2c2416]">{c.pct}%</span>
                </div>
                <p className="text-xs font-medium text-[#7a6a50]">{c.cat}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Settings Screen ──────────────────────────────────────────────────────────
function Settings({ settings, onUpdateSettings }) {
  const toggle = key => {
    onUpdateSettings(s => ({ ...s, [key]: !s[key] }))
  }

  const Toggle = ({ on, onToggle }) => (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-[#2c2416]' : 'bg-[#e8ddc8]'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-2xl font-semibold text-[#2c2416] mb-6">Settings</h1>

      <div className="space-y-4">
        {/* Business info */}
        <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f5edd6] bg-[#fffcf5]">
            <h2 className="font-semibold text-[#2c2416] text-sm">Business Information</h2>
          </div>
          <div className="p-5 space-y-4">
            {[
              { label: 'Business Name', key: 'businessName' },
              { label: 'Email Address', key: 'email' },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="text-xs font-medium text-[#a8977e] block mb-1.5">{label}</label>
                <input
                  type="text"
                  value={settings[key]}
                  onChange={e => onUpdateSettings(s => ({ ...s, [key]: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8ddc8] text-sm text-[#2c2416] focus:outline-none focus:border-[#ddcca6] focus:ring-2 focus:ring-[#ddcca6]/20 transition-all"
                />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#a8977e] block mb-1.5">Currency</label>
                <select
                  value={settings.currency}
                  onChange={e => onUpdateSettings(s => ({ ...s, currency: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8ddc8] text-sm text-[#2c2416] focus:outline-none focus:border-[#ddcca6] bg-white transition-all"
                >
                  <option value="PHP">PHP (₱ Philippine Peso)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#a8977e] block mb-1.5">Tax Rate (%)</label>
                <input
                  type="number"
                  value={settings.taxRate}
                  onChange={e => onUpdateSettings(s => ({ ...s, taxRate: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#e8ddc8] text-sm text-[#2c2416] focus:outline-none focus:border-[#ddcca6] transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="bg-white rounded-2xl border border-[#f0e8d8] shadow-[0_1px_8px_rgba(44,36,22,0.05)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f5edd6] bg-[#fffcf5]">
            <h2 className="font-semibold text-[#2c2416] text-sm">Preferences</h2>
          </div>
          <div className="divide-y divide-[#f5edd6]">
            {[
              { label: 'Receipt Printing', sub: 'Auto-print receipts after payment', key: 'receiptPrinting' },
              { label: 'Sound Effects', sub: 'Play sounds on add to cart and payment', key: 'soundEffects' },
              { label: 'Low Stock Alerts', sub: 'Notify when stock falls below 15 units', key: 'lowStockAlerts' },
              { label: 'Dark Mode', sub: 'Switch to dark theme (coming soon)', key: 'darkMode' },
            ].map(({ label, sub, key }) => (
              <div key={key} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-[#2c2416]">{label}</p>
                  <p className="text-xs text-[#a8977e]">{sub}</p>
                </div>
                <Toggle on={settings[key]} onToggle={() => toggle(key)} />
              </div>
            ))}
          </div>
        </div>

        {/* Save */}
        <button className="w-full py-3.5 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold hover:bg-[#3d3220] active:scale-[0.99] transition-all">
          Save Settings
        </button>
      </div>
    </div>
  )
}

// ─── Login screen ───────────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, App's onAuthStateChange listener picks up the session and
    // this component unmounts — no need to reset loading here.
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#fff9ea] p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#f0e8d8] p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={dimpzCafeLogo} alt="Dimp'z Cafe" className="w-14 h-14 object-contain mb-3" />
          <h1 style={{ fontFamily: 'var(--font-serif)' }} className="text-xl font-semibold text-[#2c2416]">Staff Login</h1>
          <p className="text-xs text-[#a8977e] mt-1 tracking-widest uppercase">Dimp'z Cafe Point of Sale</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" required autoComplete="username" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@dimpzcafe.com" />
          </div>
          <div>
            <label className={labelClass}>Password</label>
            <input type="password" required autoComplete="current-password" className={inputClass} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {error && <p className="text-xs text-[#b85c42]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-[#2c2416] text-[#ddcca6] font-semibold hover:bg-[#3d3220] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Spinner className="w-4 h-4" />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="text-xs text-[#a8977e] text-center mt-6">Staff accounts are created by your manager. Contact them if you need access.</p>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined) // undefined = checking, null = signed out
  const [screen, setScreen] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cart, setCart] = useState([])
  const [isMobile, setIsMobile] = useState(false)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState('')
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
    } catch {
      return DEFAULT_SETTINGS
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // localStorage unavailable (e.g. private browsing) — settings still work for this session
    }
  }, [settings])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const refetchItems = () => {
    setItemsLoading(true)
    setItemsError('')
    api.fetchProducts()
      .then(setItems)
      .catch(err => setItemsError(err.message || 'Could not load products'))
      .finally(() => setItemsLoading(false))
  }

  useEffect(() => {
    if (session) refetchItems()
  }, [session])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close sidebar on mobile when screen changes
  useEffect(() => {
    if (isMobile) setSidebarOpen(false)
  }, [screen, isMobile])

  const addItem = async newItem => {
    const created = await api.insertProduct(newItem)
    setItems(prev => [...prev, created])
  }

  const updateStock = async (id, stock) => {
    const item = items.find(i => i.id === id)
    if (!item) return
    await api.updateProductStock(id, item.stock, stock)
    setItems(prev => prev.map(i => i.id === id ? { ...i, stock } : i))
  }

  const updateItem = async (id, patch) => {
    const updated = await api.updateProduct(id, patch)
    setItems(prev => prev.map(i => i.id === id ? updated : i))
  }

  const deleteItem = async id => {
    await api.deleteProduct(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const chargeSale = async ({ customerName, items: saleItems, total, paymentMethod }) => {
    const sale = await api.recordSale({ customerName, items: saleItems, total, paymentMethod })
    // Reflect the stock decrement locally so Products/Inventory update without a refetch.
    setItems(prev => prev.map(p => {
      const sold = saleItems.find(i => i.id === p.id)
      return sold ? { ...p, stock: Math.max(0, p.stock - sold.qty) } : p
    }))
    return sale
  }

  const addToCart = product => {
    setCart(prev => {
      const exists = prev.find(i => i.id === product.id)
      if (exists) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...product, quantity: 1 }]
    })
  }

  const updateQty = (id, delta) => {
    setCart(prev =>
      prev
        .map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
        .filter(i => i.quantity > 0)
    )
  }

  const removeFromCart = id => setCart(prev => prev.filter(i => i.id !== id))
  const clearCart = () => setCart([])

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  if (session === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#fff9ea]">
        <Spinner />
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  const renderScreen = () => {
    switch (screen) {
      case 'dashboard': return <Dashboard onNavigate={setScreen} cart={cart} />
      case 'products': return <Products items={items} itemsLoading={itemsLoading} itemsError={itemsError} onRetryItems={refetchItems} onAddItem={addItem} onUpdateItem={updateItem} onDeleteItem={deleteItem} onAddToCart={addToCart} onUpdateQty={updateQty} onRemove={removeFromCart} cart={cart} onNavigate={setScreen} />
      case 'checkout': return <Checkout cart={cart} onUpdateQty={updateQty} onRemove={removeFromCart} onClearCart={clearCart} onCharge={chargeSale} businessName={settings.businessName} receiptPrintingEnabled={settings.receiptPrinting} />
      case 'inventory': return <Inventory items={items} itemsLoading={itemsLoading} itemsError={itemsError} onRetryItems={refetchItems} onAddItem={addItem} onUpdateStock={updateStock} onDeleteItem={deleteItem} />
      case 'customers': return <Customers />
      case 'reports': return <Reports items={items} businessName={settings.businessName} />
      case 'settings': return <Settings settings={settings} onUpdateSettings={setSettings} />
      default: return null
    }
  }

  const navLabel = NAV_ITEMS.find(n => n.id === screen)?.label || ''

  return (
    <div className="flex h-screen overflow-hidden bg-[#fff9ea]">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && isMobile && (
        <div className="fixed inset-0 bg-black/30 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:relative inset-y-0 left-0 z-40
          flex flex-col w-60 bg-[#2c2416] text-[#e8ddc8]
          transition-transform duration-300 ease-in-out
          ${sidebarOpen || !isMobile ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:flex shrink-0
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img
              src={dimpzCafeLogo}
              alt="Dimp'z Cafe logo"
              className="w-10 h-10 object-contain rounded-lg bg-white/90 p-0.5"
            />
            <div>
              <p style={{ fontFamily: 'var(--font-serif)' }} className="text-[#ddcca6] font-semibold text-sm leading-tight">Dimp'z Cafe</p>
              <p className="text-[10px] text-[#7a6a50] tracking-widest uppercase">Point of Sale</p>
            </div>
          </div>
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} className="text-[#a8977e] hover:text-[#ddcca6]">
              <IconX />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                screen === item.id
                  ? 'bg-[#ddcca6] text-[#2c2416]'
                  : 'text-[#a8977e] hover:bg-white/5 hover:text-[#e8ddc8]'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={screen === item.id ? 'text-[#2c2416]' : 'text-[#7a6a50]'}>
                  {NAV_ICONS[item.id]}
                </span>
                {item.label}
              </div>
              {item.id === 'checkout' && cartCount > 0 && (
                <span className={`text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold ${
                  screen === item.id ? 'bg-[#2c2416] text-[#ddcca6]' : 'bg-[#ddcca6] text-[#2c2416]'
                }`}>{cartCount}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3 min-w-0">
            <img src={dimpzCafeLogo} alt="Dimp'z Cafe" className="w-8 h-8 rounded-lg bg-white/90 object-contain p-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#e8ddc8] truncate">{session.user.email}</p>
              <p className="text-[10px] text-[#7a6a50]">Staff · Signed in</p>
            </div>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full text-left text-xs text-[#a8977e] hover:text-[#ddcca6] transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 bg-white border-b border-[#f0e8d8] shrink-0 shadow-[0_1px_4px_rgba(44,36,22,0.04)]">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-[#7a6a50] hover:text-[#2c2416] p-1 transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <IconMenu />
            </button>
            <img src={dimpzCafeLogo} alt="Dimp'z Cafe" className="md:hidden w-7 h-7 object-contain" />
            <h2 className="font-semibold text-[#2c2416] text-sm md:text-base">{navLabel}</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Cart badge */}
            <button
              onClick={() => setScreen('checkout')}
              className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-[#fff9ea] border border-[#e8ddc8] text-[#7a6a50] hover:border-[#ddcca6] transition-all"
            >
              <IconCart />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#2c2416] text-[#ddcca6] text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
            {/* Time */}
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-medium text-[#2c2416]">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-[10px] text-[#a8977e]">Jul 25, 2026</span>
            </div>
          </div>
        </header>

        {/* Screen content */}
        <main className="flex-1 overflow-y-auto">
          {renderScreen()}
          {/* Mobile bottom padding */}
          <div className="h-20 md:h-0" />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-[#f0e8d8] shadow-[0_-2px_12px_rgba(44,36,22,0.08)]">
        <div className="flex">
          {NAV_ITEMS.slice(0, 5).map(item => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 relative transition-colors ${
                screen === item.id ? 'text-[#2c2416]' : 'text-[#c4ae88]'
              }`}
            >
              <span className="relative">
                {NAV_ICONS[item.id]}
                {item.id === 'checkout' && cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#ddcca6] text-[#2c2416] text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
              {screen === item.id && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#2c2416] rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
