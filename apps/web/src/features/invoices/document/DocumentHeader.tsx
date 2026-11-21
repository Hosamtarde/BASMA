import type { ReactNode } from 'react';

type Td = (key: string, options?: Record<string, unknown>) => string;

export interface HeaderLab {
  phone: string | null;
  address: string | null;
  slogan: string | null;
}

/**
 * The top of every printed document (invoices and vouchers): the lab's own logo (when it has one) and name,
 * its phone and address, and the document's title with a meta box on the other side. The only identity ever
 * printed is the lab's (SPEC §2.3): this file never names the product.
 */
export function DocumentHeader({
  lab,
  labName,
  logoUrl,
  td,
  title,
  children,
}: {
  lab: HeaderLab;
  labName: string;
  /** Object URL of the lab logo, or null for the name only. */
  logoUrl: string | null;
  td: Td;
  title: string;
  /** The meta rows: `<div><dt/><dd/></div>` items. */
  children: ReactNode;
}) {
  return (
    <header className="inv-head">
      <div className="inv-lab">
        {logoUrl !== null && <img src={logoUrl} alt={td('invoiceDoc.logoAlt', { name: labName })} data-lab-logo="" />}
        <div className="inv-lab-info">
          <span className="inv-lab-name" dir="auto">
            {labName}
          </span>
          {lab.slogan && (
            <span dir="auto" className="block">
              {lab.slogan}
            </span>
          )}
          {lab.phone && (
            <span className="block">
              {td('invoiceDoc.phone')}: <span className="inv-num">{lab.phone}</span>
            </span>
          )}
          {lab.address && (
            <span className="block" dir="auto">
              {td('invoiceDoc.address')}: {lab.address}
            </span>
          )}
        </div>
      </div>
      <div className="inv-docbox">
        <h2 className="inv-title">{title}</h2>
        <dl className="inv-meta">{children}</dl>
      </div>
    </header>
  );
}
