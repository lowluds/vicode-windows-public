import React from 'react';
import { PrimaryButton } from './ui';
import { LandingBeams } from './LandingBeams';
import wolfLogo from '../assets/wolf-logo.png';

export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="landing-page">
      <LandingBeams />
      <div className="landing-bg-overlay" aria-hidden="true" />
      <main className="landing-main">
        <section className="landing-hero" aria-label="Vicode welcome">
          <div className="landing-title-row">
            <img className="landing-title-logo" src={wolfLogo} alt="Vicode logo" />
            <h1 className="landing-title">Vicode</h1>
          </div>
          <div className="landing-hero-actions">
            <PrimaryButton className="landing-get-started" onClick={onGetStarted}>
              Get Started
            </PrimaryButton>
          </div>
        </section>
      </main>
    </div>
  );
}
