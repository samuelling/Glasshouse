#!/usr/bin/env python3
"""Assemble the single-file pages (index.html, harp.html) from src/."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
def page(template, css, app, out):
    t = (src / template).read_text()
    for tag, f in [('/*CSS*/', css), ('/*DSP*/', 'dsp.js'), ('/*PHYSICS*/', 'physics.js'), ('/*APP*/', app)]:
        body = (src / f).read_text()
        assert '</script' not in body, f
        t = t.replace(tag, body, 1)
    (root / out).write_text(t)
    print(out, len(t), 'bytes')
page('template.html', 'style.css', 'app.js', 'index.html')
page('bowl-template.html', 'style.css', 'app.js', 'bowl.html')
page('harp-template.html', 'harp.css', 'harp.js', 'harp.html')
