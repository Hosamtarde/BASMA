import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, KeyRound, LogOut, UserRound } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { signOut } from '@/features/auth/api';

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] font-semibold outline-none data-[highlighted]:bg-hover [&_svg]:size-[18px] [&_svg]:text-muted';

/** Change password and sign out. Search and the notification bell arrive with their own slices. */
export function UserMenu({ username }: { username: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" aria-label={t('shell.userMenu', { name: username })}>
          <UserRound aria-hidden="true" />
          <span dir="auto">{username}</span>
          <ChevronDown aria-hidden="true" className="size-4! text-muted" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-dialog)]"
        >
          <DropdownMenu.Item className={itemClass} onSelect={() => void navigate('/change-password')}>
            <KeyRound aria-hidden="true" />
            {t('shell.changePassword')}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={itemClass}
            onSelect={async () => {
              await signOut(queryClient);
              void navigate('/login', { replace: true });
            }}
          >
            <LogOut aria-hidden="true" />
            {t('shell.logout')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
