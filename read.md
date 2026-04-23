# AuraDrive Pro

AuraDrive Pro, 2006 Toyota Corolla 1.4 D-4D icin tasarlanan OBD-II tabanli yol bilgisayari projesidir.

## Proje Yapisi

```text
yol_bilgisayari/
	backend/
		app/
			__init__.py
			main.py
			obd_service.py
		.env.example
		requirements.txt
	frontend/
		app/
			globals.css
			layout.tsx
			page.tsx
		.env.local.example
		next-env.d.ts
		next.config.js
		package.json
		postcss.config.js
		tailwind.config.ts
		tsconfig.json
	.gitignore
	read.md
```

## Backend (FastAPI + python-obd)

- Endpoint: `GET /data`
- Donen veriler:
	- `rpm`
	- `speed_kmh`
	- `maf_gps`
	- `coolant_temp_c`
	- `fuel_l_per_100km`

Anlik tuketim hesabi:

```text
((MAF * 3600) / (14.7 * 740)) / Speed * 100
```

`Speed <= 0` oldugunda `fuel_l_per_100km` `null` doner.

Calistirma:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Frontend (Next.js + Tailwind)

- Tema: Old Money + luks spor dashboard
- Arka plan: siyah
- Tipografi: fildisi beyazi
- Veri yenileme: saniyede 1 (`setInterval(1000)`)

Calistirma:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Frontend varsayilan olarak `http://127.0.0.1:8000/data` endpoint'inden veri ceker.