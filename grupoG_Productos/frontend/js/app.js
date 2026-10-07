const API_PRODUCTOS = 'http://localhost:3000/api/productos';
const API_CATEGORIAS = 'http://localhost:3000/api/categorias';

let todosLosProductos = [];


// ===============================
// CARGAR PRODUCTOS
// ===============================
async function cargarProductos() {
    const listaProductos = document.getElementById('listaProductos');

    try {
        const respuesta = await fetch(API_PRODUCTOS);

        if (!respuesta.ok) {
            throw new Error('No se pudieron obtener los productos');
        }

        todosLosProductos = await respuesta.json();

        mostrarProductos(todosLosProductos);

    } catch (error) {
        console.error('Error:', error);

        listaProductos.innerHTML = `
            <p>
                No fue posible cargar los productos.
            </p>
        `;
    }
}


// ===============================
// MOSTRAR PRODUCTOS
// ===============================
function mostrarProductos(productos) {
    const listaProductos = document.getElementById('listaProductos');

    listaProductos.innerHTML = '';

    if (productos.length === 0) {
        listaProductos.innerHTML = `
            <p>
                No hay productos en esta categoría.
            </p>
        `;
        return;
    }

    productos.forEach(producto => {

        const tarjeta = document.createElement('article');

        tarjeta.classList.add('producto');

        tarjeta.innerHTML = `
            <img
                src="${producto.imagen_url || 'https://via.placeholder.com/300x200?text=Producto'}"
                alt="${producto.nombre}"
            >

            <div class="producto-contenido">

                <h3>${producto.nombre}</h3>

                <p class="categoria-producto">
                    Categoría: ${producto.categoria}
                </p>

                <p class="descripcion">
                    ${producto.descripcion || 'Sin descripción'}
                </p>

                <p class="precio">
                    $${Number(producto.precio).toLocaleString('es-CO')}
                </p>

                <button
    class="btn"
    onclick="editarProducto(${producto.id})"
>
    Editar producto
</button>

            </div>
        `;

        listaProductos.appendChild(tarjeta);
    });
}


// ===============================
// CARGAR CATEGORÍAS
// ===============================
async function cargarCategorias() {

    const listaCategorias =
        document.getElementById('listaCategorias');

    try {

        const respuesta = await fetch(API_CATEGORIAS);

        if (!respuesta.ok) {
            throw new Error('No se pudieron obtener las categorías');
        }

        const categorias = await respuesta.json();

        listaCategorias.innerHTML = '';

        // Botón para mostrar todos
        const todas = document.createElement('button');

        todas.classList.add('categoria', 'categoria-activa');

        todas.textContent = 'Todas';

        todas.addEventListener('click', () => {

            mostrarProductos(todosLosProductos);

            marcarCategoriaActiva(todas);

        });

        listaCategorias.appendChild(todas);


        // Crear botones de categorías
        categorias.forEach(categoria => {

            const elemento = document.createElement('button');

            elemento.classList.add('categoria');

            elemento.textContent = categoria.nombre;

            elemento.addEventListener('click', () => {

                const productosFiltrados =
                    todosLosProductos.filter(
                        producto =>
                            producto.categoria_id === categoria.id
                    );

                mostrarProductos(productosFiltrados);

                marcarCategoriaActiva(elemento);

            });

            listaCategorias.appendChild(elemento);

        });

    } catch (error) {

        console.error('Error:', error);

        listaCategorias.innerHTML = `
            <p>
                No fue posible cargar las categorías.
            </p>
        `;
    }
}


// ===============================
// MARCAR CATEGORÍA ACTIVA
// ===============================
function marcarCategoriaActiva(botonSeleccionado) {

    const botones =
        document.querySelectorAll('.categoria');

    botones.forEach(boton => {
        boton.classList.remove('categoria-activa');
    });

    botonSeleccionado.classList.add('categoria-activa');
}


// ===============================
// INICIAR APLICACIÓN
// ===============================
cargarProductos();
cargarCategorias();
// ===============================
// CARGAR CATEGORÍAS EN EL FORMULARIO
// ===============================
async function cargarCategoriasFormulario() {

    const selectCategoria =
        document.getElementById('categoria_id');

    try {

        const respuesta = await fetch(API_CATEGORIAS);

        if (!respuesta.ok) {
            throw new Error('No se pudieron obtener las categorías');
        }

        const categorias = await respuesta.json();

        selectCategoria.innerHTML = `
            <option value="">Seleccionar categoría</option>
        `;

        categorias.forEach(categoria => {

            const opcion = document.createElement('option');

            opcion.value = categoria.id;
            opcion.textContent = categoria.nombre;

            selectCategoria.appendChild(opcion);
        });

    } catch (error) {

        console.error('Error al cargar categorías:', error);

    }
}


// ===============================
// REGISTRAR O ACTUALIZAR PRODUCTO
// ===============================
document
    .getElementById('formProducto')
    .addEventListener('submit', async (event) => {

        event.preventDefault();

        const id =
            document.getElementById('productoId').value;

        const producto = {

            nombre:
                document.getElementById('nombre').value,

            precio:
                document.getElementById('precio').value,

            categoria_id:
                document.getElementById('categoria_id').value,

            imagen_url:
                document.getElementById('imagen_url').value,

            descripcion:
                document.getElementById('descripcion').value
        };

        try {

            let respuesta;

            // Si existe ID estamos editando
            if (id) {

                respuesta = await fetch(
                    `${API_PRODUCTOS}/${id}`,
                    {
                        method: 'PUT',

                        headers: {
                            'Content-Type': 'application/json'
                        },

                        body: JSON.stringify(producto)
                    }
                );

            } else {

                // Si no existe ID estamos registrando
                respuesta = await fetch(
                    API_PRODUCTOS,
                    {
                        method: 'POST',

                        headers: {
                            'Content-Type': 'application/json'
                        },

                        body: JSON.stringify(producto)
                    }
                );
            }

            const resultado = await respuesta.json();

            if (!respuesta.ok) {
                throw new Error(
                    resultado.mensaje ||
                    'Ocurrió un error'
                );
            }

            mostrarMensaje(resultado.mensaje);

            limpiarFormulario();

            await cargarProductos();

        } catch (error) {

            console.error(error);

            mostrarMensaje(
                'Error: ' + error.message
            );
        }
    });


// ===============================
// MOSTRAR MENSAJE
// ===============================
function mostrarMensaje(mensaje) {

    const elemento =
        document.getElementById('mensajeFormulario');

    elemento.textContent = mensaje;
}


// ===============================
// LIMPIAR FORMULARIO
// ===============================
function limpiarFormulario() {

    document
        .getElementById('formProducto')
        .reset();

    document
        .getElementById('productoId')
        .value = '';

    document
        .getElementById('btnGuardar')
        .textContent = 'Registrar producto';

    document
        .getElementById('btnCancelar')
        .style.display = 'none';
}
cargarCategoriasFormulario();
// ===============================
// EDITAR PRODUCTO
// ===============================
function editarProducto(id) {

    const producto =
        todosLosProductos.find(
            producto => producto.id === id
        );

    if (!producto) {
        return;
    }

    document.getElementById('productoId').value =
        producto.id;

    document.getElementById('nombre').value =
        producto.nombre;

    document.getElementById('precio').value =
        producto.precio;

    document.getElementById('categoria_id').value =
        producto.categoria_id;

    document.getElementById('imagen_url').value =
        producto.imagen_url || '';

    document.getElementById('descripcion').value =
        producto.descripcion || '';

    document.getElementById('btnGuardar').textContent =
        'Actualizar producto';

    document.getElementById('btnCancelar').style.display =
        'inline-block';

    document
        .querySelector('.administracion')
        .scrollIntoView({
            behavior: 'smooth'
        });
}
document
    .getElementById('btnCancelar')
    .addEventListener('click', () => {

        limpiarFormulario();

        mostrarMensaje('');
    });