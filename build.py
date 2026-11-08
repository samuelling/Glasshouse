#!/usr/bin/env python3
"""Assemble the single-file index.html from src/."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
t = (src / 'template.html').read_text()
for tag, f in [('/*CSS*/', 'style.css'), ('/*DSP*/', 'dsp.js'), ('/*PHYSICS*/', 'physics.js'), ('/*APP*/', 'app.js')]:
    body = (src / f).read_text()
    assert '</script' not in body, f
    t = t.replace(tag, body, 1)
(root / 'index.html').write_text(t)
print('index.html', len(t), 'bytes')
