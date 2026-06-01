QR image fixtures for tests.

sample_qr.png — receipt with QR code encoding:
    t=20260520T1430&s=599.00&fn=9999000000000001&i=100001&fp=2345678&n=1

Generate with:
    python -c "
import qrcode, pathlib
data = 't=20260520T1430&s=599.00&fn=9999000000000001&i=100001&fp=2345678&n=1'
img = qrcode.make(data)
img.save('tests/fixtures/images/sample_qr.png')
"

These files are not committed to avoid binary bloat.
Tests that need them should either:
  1. Generate programmatically in conftest.py (via qrcode package)
  2. Skip with pytest.mark.skip('No QR fixture available')
