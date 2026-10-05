import os
import secrets

import bcrypt
import pymysql
from pymysql.cursors import DictCursor
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

import os
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = dict(
	unix_socket="/run/mysqld/mysqld.sock",
	host=os.getenv("DB_HOST", "localhost"),
	port=int(os.getenv("DB_PORT", "3306")),
	user=os.getenv("DB_USER", "root"),
	password=os.getenv("DB_PASSWORD", ""),
	database=os.getenv("DB_NAME", "ecommerce"),
	charset="utf8mb4",
	cursorclass=DictCursor,
)

SECRET_KEY = os.getenv("SECRET_KEY", "cookie")

app = FastAPI(title="Clientes")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, same_site="lax", https_only=False)
templates = Jinja2Templates(directory="templates")

CAMPOS_PUBLICOS = (
	"id, primer_nombre, segundo_nombre, primer_apellido, "
	"segundo_apellido, correo, estado"
)


# ---------- Utilidades ----------
def get_db():
	conn = pymysql.connect(**DB_CONFIG)
	try:
		yield conn
	finally:
		conn.close()


def hashear(password: str) -> str:
	return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verificar(password: str, hash_: str) -> bool:
	try:
		return bcrypt.checkpw(password.encode(), hash_.encode())
	except ValueError:
		return False


def password_valida(password: str) -> str | None:
	"""Devuelve un mensaje de error o None si es válida."""
	if len(password) < 8:
		return "La contraseña debe tener al menos 8 caracteres."
	if len(password.encode()) > 72:
		return "La contraseña es demasiado larga (máx. 72 bytes)."
	return None


def vacio_a_none(valor: str | None) -> str | None:
	valor = (valor or "").strip()
	return valor or None


def cliente_actual(request: Request, db):
	cid = request.session.get("cliente_id")
	if not cid:
		return None
	with db.cursor() as cur:
		cur.execute(f"SELECT {CAMPOS_PUBLICOS} FROM Cliente WHERE id = %s", (cid,))
		return cur.fetchone()


def render(request: Request, nombre: str, **ctx):
	return templates.TemplateResponse(request, nombre, ctx)


# ---------- Páginas ----------
@app.get("/")
def inicio(request: Request):
	destino = "/perfil" if request.session.get("cliente_id") else "/login"
	return RedirectResponse(destino, status_code=303)


@app.get("/registro")
def registro_form(request: Request):
	return render(request, "registro.html", datos={})


@app.post("/registro")
def registro(
	request: Request,
	primer_nombre: str = Form(...),
	segundo_nombre: str = Form(""),
	primer_apellido: str = Form(...),
	segundo_apellido: str = Form(""),
	correo: str = Form(...),
	password: str = Form(...),
	db=Depends(get_db),
):
	datos = dict(
		primer_nombre=primer_nombre.strip(),
		segundo_nombre=vacio_a_none(segundo_nombre),
		primer_apellido=primer_apellido.strip(),
		segundo_apellido=vacio_a_none(segundo_apellido),
		correo=correo.strip().lower(),
	)

	error = password_valida(password)
	if error:
		return render(request, "registro.html", datos=datos, error=error)

	try:
		with db.cursor() as cur:
			cur.execute("SELECT id FROM Cliente WHERE correo = %s", (datos["correo"],))
			if cur.fetchone():
				return render(request, "registro.html", datos=datos,
							  error="Ese correo ya está registrado.")
			cur.execute(
				"""INSERT INTO Cliente
				   (primer_nombre, segundo_nombre, primer_apellido,
					segundo_apellido, correo, `contraseña`, estado)
				   VALUES (%s, %s, %s, %s, %s, %s, 1)""",
				(datos["primer_nombre"], datos["segundo_nombre"],
				 datos["primer_apellido"], datos["segundo_apellido"],
				 datos["correo"], hashear(password)),
			)
		db.commit()
	except pymysql.err.IntegrityError:
		db.rollback()
		return render(request, "registro.html", datos=datos,
					  error="Ese correo ya está registrado.")

	return RedirectResponse("/login?registrado=1", status_code=303)


@app.get("/login")
def login_form(request: Request, registrado: int = 0):
	ok = "Registro exitoso. Ya puedes iniciar sesión." if registrado else None
	return render(request, "login.html", ok=ok)


@app.post("/login")
def login(
	request: Request,
	correo: str = Form(...),
	password: str = Form(...),
	db=Depends(get_db),
):
	with db.cursor() as cur:
		cur.execute(
			"SELECT id, `contraseña` AS hash, estado FROM Cliente WHERE correo = %s",
			(correo.strip().lower(),),
		)
		fila = cur.fetchone()

	if not fila or not verificar(password, fila["hash"]):
		return render(request, "login.html", error="Correo o contraseña incorrectos.")
	if fila["estado"] == 0:
		return render(request, "login.html", error="Tu cuenta está desactivada.")

	request.session.clear()
	request.session["cliente_id"] = fila["id"]
	return RedirectResponse("/perfil", status_code=303)


@app.get("/perfil")
def perfil(request: Request, guardado: int = 0, db=Depends(get_db)):
	cliente = cliente_actual(request, db)
	if not cliente:
		return RedirectResponse("/login", status_code=303)
	ok = "Datos actualizados correctamente." if guardado else None
	return render(request, "perfil.html", cliente=cliente, ok=ok)


@app.post("/perfil")
def actualizar_perfil(
	request: Request,
	primer_nombre: str = Form(...),
	segundo_nombre: str = Form(""),
	primer_apellido: str = Form(...),
	segundo_apellido: str = Form(""),
	correo: str = Form(...),
	nueva_password: str = Form(""),
	db=Depends(get_db),
):
	cliente = cliente_actual(request, db)
	if not cliente:
		return RedirectResponse("/login", status_code=303)

	datos = dict(
		id=cliente["id"],
		primer_nombre=primer_nombre.strip(),
		segundo_nombre=vacio_a_none(segundo_nombre),
		primer_apellido=primer_apellido.strip(),
		segundo_apellido=vacio_a_none(segundo_apellido),
		correo=correo.strip().lower(),
	)

	if nueva_password:
		error = password_valida(nueva_password)
		if error:
			return render(request, "perfil.html", cliente=datos, error=error)

	try:
		with db.cursor() as cur:
			cur.execute(
				"SELECT id FROM Cliente WHERE correo = %s AND id <> %s",
				(datos["correo"], cliente["id"]),
			)
			if cur.fetchone():
				return render(request, "perfil.html", cliente=datos,
							  error="Ese correo ya lo usa otra cuenta.")

			sql = """UPDATE Cliente SET primer_nombre=%s, segundo_nombre=%s,
					 primer_apellido=%s, segundo_apellido=%s, correo=%s"""
			params = [datos["primer_nombre"], datos["segundo_nombre"],
					  datos["primer_apellido"], datos["segundo_apellido"],
					  datos["correo"]]
			if nueva_password:
				sql += ", `contraseña`=%s"
				params.append(hashear(nueva_password))
			sql += " WHERE id=%s"
			params.append(cliente["id"])
			cur.execute(sql, params)
		db.commit()
	except pymysql.err.IntegrityError:
		db.rollback()
		return render(request, "perfil.html", cliente=datos,
					  error="Ese correo ya lo usa otra cuenta.")

	return RedirectResponse("/perfil?guardado=1", status_code=303)


@app.post("/logout")
def logout(request: Request):
	request.session.clear()
	return RedirectResponse("/login", status_code=303)


class ConsultaCliente(BaseModel):
	id: int


@app.post("/cliente")
def api_cliente(
	consulta: ConsultaCliente,
	db=Depends(get_db),
):

	with db.cursor() as cur:
		cur.execute(f"SELECT {CAMPOS_PUBLICOS} FROM Cliente WHERE id = %s", (consulta.id,))
		fila = cur.fetchone()
	if not fila:
		raise HTTPException(status_code=404, detail="Cliente no encontrado")
	return fila
