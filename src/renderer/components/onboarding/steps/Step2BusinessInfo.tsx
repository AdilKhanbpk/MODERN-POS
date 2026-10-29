import React from 'react';
import { BusinessInfoInput } from '../../../../shared/types/onboarding';

interface Props {
  data: BusinessInfoInput;
  onChange: (data: BusinessInfoInput) => void;
  errors?: Record<string, string>;
}

export const Step2BusinessInfo: React.FC<Props> = ({ data, onChange, errors }) => {
  const handleChange = (field: keyof BusinessInfoInput, value: string) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-slate-100">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Business Information</h2>
        <p className="text-sm text-slate-400 mt-1">
          Enter your company profile. This information will appear on sales receipts and tax invoices.
        </p>
      </div>

      <div className="space-y-4 bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
        {/* Business Name */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Business Trade Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={data.name || ''}
            onChange={e => handleChange('name', e.target.value)}
            placeholder="e.g. Al-Madina Supermarket, Metro Shoes, City Medicos"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
          {errors?.['businessInfo.name'] && (
            <p className="text-xs text-rose-400 mt-1">{errors['businessInfo.name']}</p>
          )}
        </div>

        {/* Legal Name */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Legal Registered Name <span className="text-slate-500 font-normal">(Optional)</span>
          </label>
          <input
            type="text"
            value={data.legalName || ''}
            onChange={e => handleChange('legalName', e.target.value)}
            placeholder="e.g. Al-Madina Retail (Pvt) Ltd"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Phone */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Primary Phone Number <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={data.phone || ''}
              onChange={e => handleChange('phone', e.target.value)}
              placeholder="e.g. 0300-1234567 or 051-2233445"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
            {errors?.['businessInfo.phone'] && (
              <p className="text-xs text-rose-400 mt-1">{errors['businessInfo.phone']}</p>
            )}
          </div>

          {/* Registration Number */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Tax / Registration No <span className="text-slate-500 font-normal">(NTN/STRN/VAT)</span>
            </label>
            <input
              type="text"
              value={data.registrationNumber || ''}
              onChange={e => handleChange('registrationNumber', e.target.value)}
              placeholder="e.g. NTN-1234567-8"
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Business Email <span className="text-slate-500 font-normal">(Optional)</span>
          </label>
          <input
            type="email"
            value={data.email || ''}
            onChange={e => handleChange('email', e.target.value)}
            placeholder="e.g. store@business.com"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
          {errors?.['businessInfo.email'] && (
            <p className="text-xs text-rose-400 mt-1">{errors['businessInfo.email']}</p>
          )}
        </div>

        {/* Physical Address */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
            Physical Shop / Office Address
          </label>
          <textarea
            rows={3}
            value={data.address || ''}
            onChange={e => handleChange('address', e.target.value)}
            placeholder="Shop #12, Commercial Market, Sector G-9, Islamabad"
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition"
          />
        </div>
      </div>
    </div>
  );
};

