// payroll.model.js
const mongoose = require('mongoose');

/* -----------------------------------------------------------
 * Sub-Schemas
 * --------------------------------------------------------- */

/**
 * Generic money item.
 * Keeps the name (label) and the amount.
 * Can be used for allowances, deductions, overtime breakdowns …etc.
 */
const MoneyItemSchema = new mongoose.Schema(
  {
    label:   { type: String, required: true }, // e.g. '基本給', '健康保険料'
    amount:  { type: Number, required: true }, // store in the smallest unit (JPY = integer)
    // Anything else that may come later (percentage, remarks …etc.)
    extra:   { type: mongoose.Schema.Types.Mixed } 
  },
  { _id: false }
);

/**
 * Attendance (勤怠) information.
 * All time values are stored in minutes so that they can be calculated easily
 * but you can format them as “HH:mm” in the UI layer.
 */
const AttendanceSchema = new mongoose.Schema(
  {
    /* day based values */
    daysWorked:        { type: Number, default: 0 }, // 出勤日数
    daysOff:           { type: Number, default: 0 }, // 休日日数
    specialHoliday:    { type: Number, default: 0 }, // 特休日数
    paidLeaveDays:     { type: Number, default: 0 }, // 有休日数
    absenceDays:       { type: Number, default: 0 }, // 欠勤日数
    remainingLeaveDays:{ type: Number, default: 0 }, // 有休残

    /* hour / minute based values (all in minutes) */
    paidLeaveMinutes:          { type: Number, default: 0 }, // 時間有休
    remainingLeaveMinutes:     { type: Number, default: 0 }, // 有休残時間
    remainingHourlyLeaveMin:   { type: Number, default: 0 }, // 時間有休残
    workingMinutes:            { type: Number, default: 0 }, // 出勤時間
    lateEarlyMinutes:          { type: Number, default: 0 }, // 遅早時間
    regularOvertimeMinutes:    { type: Number, default: 0 }, // 普通残業時間

    /* Extra metrics that may be added later (night OT, holiday OT …etc.) */
    extras: {
      type: Map,
      of: Number,           // <metricName, value>
      default: {}
    }
  },
  { _id: false }
);

/* -----------------------------------------------------------
 * Payroll Schema
 * --------------------------------------------------------- */
const PayrollSchema = new mongoose.Schema(
  {
    /* Identification ------------------------------------------------ */
    employeeNo:   { type: String, required: true },          // 社員番号
    employeeName: { type: String, required: true },          // 氏名
    department:   { type: String },                          // 所属

    /* Target month & pay date -------------------------------------- */
    month:    { type: String, required: true },              // ‘YYYY-MM’  (令和7年4月 -> '2025-04')
    payDate:  { type: Date,   required: true },              // 給与支給日

    /* Payroll period ----------------------------------------------- */
    periodStart: { type: Date, required: true },             // 賃金計算期間開始日
    periodEnd:   { type: Date, required: true },             // 賃金計算期間終了日

    /* Attendance block --------------------------------------------- */
    attendance:  AttendanceSchema,

    /* Earnings (支給) / Deductions (控除) --------------------------- */
    earnings:    { type: [MoneyItemSchema], default: [] },   // 基本給・各種手当 …
    deductions:  { type: [MoneyItemSchema], default: [] },   // 保険料・税金 …

    /* Totals / Settlement ------------------------------------------ */
    grossAmount:        { type: Number, required: true },    // 総支給金額
    totalDeductions:    { type: Number, required: true },    // 控除合計額
    netAmount:          { type: Number, required: true },    // 差引支給額
    bankTransferAmount: { type: Number, required: true },    // 銀行振込額

    /* Miscellaneous ------------------------------------------------- */
    notes: { type: String },                                 // 予備

    /* Catch-all bucket for future expansion ------------------------ */
    meta: {
      type: Map,
      of: mongoose.Schema.Types.Mixed, // <key, anyValue>
      default: {}
    }
  },
  { 
    timestamps: true,                // createdAt / updatedAt
    collection: 'payrolls' 
  }
);

/* Optional uniqueness: one record per employee per month */
PayrollSchema.index({ employeeNo: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', PayrollSchema);
