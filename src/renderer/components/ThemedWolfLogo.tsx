import wolfLogoDark from '../assets/wolf-logo.png';
import wolfLogoLight from '../assets/wolf-logo-light.png';
import { cx } from './ui/utils';

interface ThemedWolfLogoProps {
  className?: string;
  alt?: string;
}

export function ThemedWolfLogo({ className, alt = 'Vicode logo' }: ThemedWolfLogoProps) {
  const accessibleProps = alt
    ? { role: 'img' as const, 'aria-label': alt }
    : { 'aria-hidden': true };

  return (
    <span className={cx('themed-wolf-logo', className)} {...accessibleProps}>
      <img className="themed-wolf-logo-image themed-wolf-logo-dark" src={wolfLogoDark} alt="" aria-hidden="true" />
      <img className="themed-wolf-logo-image themed-wolf-logo-light" src={wolfLogoLight} alt="" aria-hidden="true" />
    </span>
  );
}
