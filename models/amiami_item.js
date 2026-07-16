const mongoose = require('mongoose');

const AmiAmiListingSchema = new mongoose.Schema({
  gcode: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  itemName: { type: String, default: null, trim: true },
  brand: { type: String, default: null, trim: true },
  priceText: { type: String, default: null, trim: true },
  imageUrl: { type: String, default: null, trim: true },
  tags: [{ type: String, trim: true }],
}, { _id: false });

const AmiAmiPriceSchema = new mongoose.Schema({
  currentJpy: { type: Number, default: null },
  comparisonJpy: { type: Number, default: null },
  listJpy: { type: Number, default: null },
  points: { type: Number, default: null },
}, { _id: false });

const AmiAmiFlagsSchema = new mongoose.Schema({
  sale: { type: Boolean, default: false },
  preOrder: { type: Boolean, default: false },
  backOrder: { type: Boolean, default: false },
  preOwned: { type: Boolean, default: false },
  storeBonus: { type: Boolean, default: false },
  amiamiLimited: { type: Boolean, default: false },
  orderClosed: { type: Boolean, default: false },
  soldOut: { type: Boolean, default: false },
  ageRestricted: { type: Boolean, default: false },
}, { _id: false });

const AmiAmiDetailSchema = new mongoose.Schema({
  gcode: { type: String, default: null, trim: true },
  scode: { type: String, default: null, trim: true },
  itemName: { type: String, default: null, trim: true },
  price: { type: AmiAmiPriceSchema, default: null },
  releaseDate: { type: String, default: null, trim: true },
  brand: { type: String, default: null, trim: true },
  seriesTitle: { type: String, default: null, trim: true },
  seriesTitles: [{ type: String, trim: true }],
  originalTitles: [{ type: String, trim: true }],
  characterName: { type: String, default: null, trim: true },
  characterNames: [{ type: String, trim: true }],
  sculptor: { type: String, default: null, trim: true },
  sculptorGroup: { type: String, default: null, trim: true },
  specifications: { type: String, default: null },
  details: { type: String, default: null },
  remarks: { type: String, default: null },
  janCode: { type: String, default: null, trim: true },
  copyright: { type: String, default: null },
  saleStatus: { type: String, default: null, trim: true },
  flags: { type: AmiAmiFlagsSchema, default: null },
  imageLinks: [{ type: String, trim: true }],
  sourceUrl: { type: String, default: null, trim: true },
  apiFetchedAt: { type: Date, default: null },
  raw: { type: mongoose.Schema.Types.Mixed, default: undefined },
}, { _id: false, minimize: false });

const AmiAmiItemSchema = new mongoose.Schema({
  gcode: { type: String, required: true, unique: true, index: true, trim: true },
  url: { type: String, required: true, trim: true },
  source: { type: String, required: true, default: 'amiami-new-products', index: true },
  sourceUrl: { type: String, required: true, trim: true },
  firstSeenAt: { type: Date, required: true, index: true },
  lastSeenAt: { type: Date, required: true, index: true },
  listingChangedAt: { type: Date, required: true, index: true },
  listingHash: { type: String, default: null, index: true },
  listing: { type: AmiAmiListingSchema, required: true },
  detailStatus: {
    type: String,
    required: true,
    enum: ['pending', 'fetched', 'error'],
    default: 'pending',
    index: true,
  },
  detailFetchedAt: { type: Date, default: null, index: true },
  detailError: {
    message: { type: String, default: null },
    at: { type: Date, default: null },
  },
  details: { type: AmiAmiDetailSchema, default: null },
}, {
  timestamps: true,
  minimize: false,
});

AmiAmiItemSchema.index({ detailStatus: 1, firstSeenAt: 1 });
AmiAmiItemSchema.index({ lastSeenAt: -1 });
AmiAmiItemSchema.index({ 'details.janCode': 1 });

module.exports = mongoose.model('amiamiitems', AmiAmiItemSchema);
