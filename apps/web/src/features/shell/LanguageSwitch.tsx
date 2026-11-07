import { Globe } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { currentLanguage, otherLanguage } from '@/i18n/i18n';
import { useSwitchLanguage } from './settings';

/** Shows the other language by its own name ("English" / "العربية") and switches in place. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const switchLanguage = useSwitchLanguage();
  const [busy, setBusy] = useState(false);
  const target = otherLanguage(currentLanguage());
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await switchLanguage(target);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Globe aria-hidden="true" />
      {/* WCAG 2.5.3: the accessible name starts with the visible text. */}
      <span lang={target}>{t(`language.name.${target}`)}</span>{' '}
      <span className="sr-only">{t(`language.switchTo.${target}`)}</span>
    </Button>
  );
}
