import React from 'react';

/**
 * the site logo. `logo.src` is the version for light backgrounds (dark text); `logo.darkSrc` (LOGO_DARK_URL) is the
 * inverted version for dark mode. The two are swapped by colour scheme in CSS (see theme.js), and blend modes drop
 * their flat backgrounds, so no box or white plate is needed. With a single logo it is shown as-is in both modes.
 */
export default function Logo({ logo, className = '' }) {
  if (!logo) return null;
  const dual = logo.darkSrc && logo.darkSrc !== logo.src;
  const imgs = dual ? (
    <>
      <img src={logo.src} alt={logo.alt} className={`logo-light w-auto object-contain ${className}`} />
      <img src={logo.darkSrc} alt={logo.alt} className={`logo-dark w-auto object-contain ${className}`} />
    </>
  ) : (
    <img src={logo.src} alt={logo.alt} className={`w-auto object-contain ${className}`} />
  );
  return logo.href ? (
    <a href={logo.href} target="_blank" rel="noopener noreferrer" className="inline-flex justify-center">
      {imgs}
    </a>
  ) : (
    <span className="inline-flex justify-center">{imgs}</span>
  );
}
