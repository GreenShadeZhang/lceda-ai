import type { LucideIcon } from 'lucide-react';
import styles from './shared.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'cancel';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconSize?: number;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconSize = 14,
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[styles.btn, styles[`btn-${variant}`], styles[`btn-${size}`], className].join(' ')}
    >
      {loading ? (
        <span className={styles.spinner} />
      ) : (
        Icon && <Icon size={iconSize} />
      )}
      {children && <span>{children}</span>}
    </button>
  );
}
