# GlassHouse

A physically modeled singing wine glass. Seen from above, you rub the rim with your finger or mouse and the glass sings.

**Play:** https://samuelling.github.io/Glasshouse/ (once GitHub Pages is switched on for `main` / root)

Nothing is sampled, and no oscillator is told what pitch to play.

- **Glass:** a thin elastic shell of revolution. Love strains, C¹ Hermite-cubic finite elements along a Bézier meridian, and one Fourier order *n* at a time, clamped at the stem. Validation: a free cylinder hits the ring-bending formula to within 0.3%.
- **Water:** potential flow in the real inner bowl shape with a pressure-release surface. The added mass comes from Ritz minimization of kinetic energy (it matches the analytic cylinder Bessel series to within 0.4%). Wet modes are re-solved in a dry-mode basis.
- **Losses:** material loss factor, cylindrical-harmonic radiation resistance (strip-wise), the Stokes boundary layer of the water slipping along the wall, and stem support.
- **Finger:** a fingertip pad with measured shear impedance, coupled to the rim through velocity-weakening friction. Stick–slip is solved implicitly every 10 µs against the glass's exact one-step mobility. Skin damping of radial and axial rim motion locks the standing wave's node under your finger, so the pattern follows you around the rim.
- **Sound:** each mode's radiated power with its cos *nθ* directivity, picked up at two virtual mics.

## Harp (`harp.html`)

This page holds 4–6 independently simulated glasses, built for iPad multi-touch, one finger per glass.

- **Tune to scale:** the auto-tuner sizes each glass (pitch scales roughly as t/R²), then pours water to land exactly on the note. It solves the full wet model and polishes the result with secant steps.
- **Spread sizes for keyboard:** staggers the glass sizes so their water ranges tile about 3.5 octaves.
- **Keys:** the on-screen keys, or a Web MIDI keyboard in Chrome or Edge, set pitch by pouring water into whichever free glass can reach the note. Water only lowers pitch, about 9–11 semitones per glass. With **Keys rub too** on, a held key also rubs its glass (armonica mode); velocity sets finger pressure and the mod wheel sets pressure globally. iPad and iPhone browsers don't implement Web MIDI, so on iPad use the on-screen keys.

`src/` holds the sources (`physics.js`, `dsp.js`, `app.js`, `harp.js`). `python3 build.py` assembles the single-file `index.html` and `harp.html`. `test/` holds the node validation scripts.
