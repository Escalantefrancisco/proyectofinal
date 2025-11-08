# Aplicación de Reserva de Asientos de Avión ✈️

Este proyecto es una aplicación web desarrollada con **AngularJS** que permite a los usuarios **reservar asientos en un avión**, visualizar cuáles ya están ocupados y **generar reportes de reservas**.

---

## 📂 Estructura del Proyecto

airplane-seat-reservation-app
├── src
│ ├── index.html # Archivo principal que inicia la aplicación
│ ├── app.js # Configuración e inicialización de AngularJS
│ ├── controllers
│ │ └── seatController.js # Controlador con la lógica de reserva de asientos
│ ├── services
│ │ └── seatService.js # Servicio que maneja los datos y operaciones de reserva
│ ├── styles
│ │ └── styles.css # Estilos CSS de la aplicación
│ ├── views
│ │ ├── seatReservation.html # Vista para seleccionar y reservar asientos
│ │ └── report.html # Vista para ver el reporte de reservas
│ └── assets
│ └── seats.json # Datos iniciales de los asientos
├── package.json # Dependencias del proyecto
└── README.md # Documentación del proyecto

---

## Instalación y Ejecución

1. **Clonar el repositorio**
```bash
git clone <repository-url>
cd airplane-seat-reservation-app


npm install

npx http-server src


http://localhost:8080

Uso
Función	Descripción
Reservar Asientos	Permite seleccionar y reservar asientos disponibles.
Ver Reservaciones	Muestra una lista de los asientos reservados con sus detalles.
Generar Reportes	Permite ver reportes de las reservas realizadas. Contribuciones

Se aceptan contribuciones mediante:

Reporte de errores (Issues)

Solicitudes de mejora (Pull Requests)

 Licencia

Este proyecto puede utilizarse libremente con fines educativos o de aprendizaje.


 
