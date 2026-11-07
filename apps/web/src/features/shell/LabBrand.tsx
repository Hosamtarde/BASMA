interface LabBrandProps {
  /** Lab name in the UI language (falls back to the other language), or null before setup. */
  name: string | null;
  /** Object URL of the uploaded logo; null = no logo, show the name only (SPEC §2.3). */
  logoUrl: string | null;
  logoAlt: string;
}

/** Lab identity at the top of the sidebar. Never falls back to the vendor (Smile Artec) logo. */
export function LabBrand({ name, logoUrl, logoAlt }: LabBrandProps) {
  return (
    <div className="mb-4 rounded-2xl bg-card px-2.5 pt-3 pb-2.5 text-center">
      {logoUrl !== null && (
        // The logo is raster: never enlarge it past its native size.
        <img src={logoUrl} alt={logoAlt} className="mx-auto block h-auto max-h-24 w-auto max-w-[176px]" />
      )}
      {name !== null && (
        <div dir="auto" className="mt-1 text-[12.5px] leading-[1.45] font-extrabold text-ink">
          {name}
        </div>
      )}
    </div>
  );
}
