angular.module('airplaneSeatReservationApp', ['ngRoute'])
  .constant('API_URL', 'http://localhost:3000/api')
  .service('ReservationService', ['$http', 'API_URL', function($http, API_URL) {
    this.getFlights = function() {
      return $http.get(API_URL + '/flights');
    };
    this.getSeats = function(flightId) {
      return $http.get(API_URL + '/flights/' + flightId + '/seats');
    };
    this.createReservation = function(payload) {
      const token = localStorage.getItem('token');
      return $http.post(API_URL + '/reservations', payload, { headers: { Authorization: 'Bearer ' + token }});
    };
    this.createMultiReservation = function(payload) {
      const token = localStorage.getItem('token');
      return $http.post(API_URL + '/reservations', payload, { headers: { Authorization: 'Bearer ' + token }})
        .then(function(res) {
          console.log('ReservationService.createMultiReservation success', res && res.data ? res.data : res);
          return res;
        })
        .catch(function(err) {
          console.error('ReservationService.createMultiReservation error', err && err.status, err && err.data ? err.data : err);
          return Promise.reject(err);
        });
    };

    // >>> NUEVO: reintento de envío de correo para una reserva existente
    this.resendReservationEmail = function(reservationId) {
      const token = localStorage.getItem('token');
      if (!reservationId) return Promise.reject(new Error('Missing reservationId'));
      return $http.post(API_URL + '/reservations/' + reservationId + '/resend-email', {}, { headers: { Authorization: 'Bearer ' + token } })
        .then(function(res) {
          console.log('ReservationService.resendReservationEmail success', res && res.data ? res.data : res);
          return res;
        })
        .catch(function(err) {
          console.error('ReservationService.resendReservationEmail error', err && err.status, err && err.data ? err.data : err);
          return Promise.reject(err);
        });
    };
  }])
  .config(['$routeProvider', function($routeProvider) {
    $routeProvider
        .when('/', {
            templateUrl: 'views/seatReservation.html',
            controller: 'SeatController'
        })
        .when('/report', {
            templateUrl: 'views/report.html',
            controller: 'ReportController'  // CORREGIDO: era 'SeatController'
        })
        .when('/login', {
            templateUrl: 'views/login.html',
            controller: 'LoginController',
            controllerAs: 'vm'
        })
        .when('/flights', {
          templateUrl: 'views/flights.html',
          controller: 'FlightsController'
        })
        .when('/reserve/:flightId', {
          templateUrl: 'views/reserve.html',
          controller: 'ReserveController'
        })
        .when('/multi-reserve/:flightId', {
          templateUrl: 'views/multi-reserve.html',
          controller: 'MultiReserveController'
        })
        .otherwise({
            redirectTo: '/'
        });
}])
.controller('SeatController', ['$scope', 'SeatService', 'ReservationService', '$location', function($scope, SeatService, ReservationService, $location) {
	// formulario / estado
	$scope.cantidad = 1;
	$scope.seat_class = 'economy';
	$scope.seleccion_manual = true;
	$scope.formStarted = false;

	// asientos cargados y seleccionados
	$scope.seats = [];
	$scope.asientosSeleccionados = [];
	$scope.reservedSeats = [];

	// modal pasajero
	$scope.passengerModalVisible = false;
	$scope.modalConfirmVisible = false;
	$scope.modal = {};
	$scope.pasajerosPorAsiento = {};

	// Cargar vuelos/asientos (promesas)
	$scope.flights = [];
	$scope.flightId = null;
	$scope.assignedFlight = null;
	$scope.flightError = null;

	// --- Asegurar closePassengerModal existe (definición clara) ---
	$scope.closePassengerModal = function() {
		$scope.passengerModalVisible = false;
		$scope.modalConfirmVisible = false;
		$scope.modal = {};
	};

	// >>> NUEVO: guardar payload último y helper para guardar reservas offline
	$scope._lastReservationPayload = null;

	$scope.saveOfflineReservation = function(payload) {
		if (!payload) {
			console.warn('saveOfflineReservation: payload vacío, no se guarda');
			return;
		}
		try {
			const key = 'offlineReservations';
			const list = JSON.parse(localStorage.getItem(key) || '[]');
			list.push(Object.assign({ saved_at: new Date().toISOString(), note: 'saved_after_email_failure' }, payload));
			localStorage.setItem(key, JSON.stringify(list));
			console.log('saveOfflineReservation: guardada localmente', payload);
			alert('La reserva ha sido guardada localmente para soporte/reintento.');
		} catch (e) {
			console.error('saveOfflineReservation error', e);
			alert('No se pudo guardar la reserva localmente.');
		}
	};

	// --- Nueva: función que asigna un vuelo automáticamente (devuelve Promise) ---
	function assignFlightAutomatically() {
		console.log('assignFlightAutomatically: inicio');
		// resetear estado
		$scope.formStarted = true;
		$scope.asientosSeleccionados = [];
		$scope.showResumen = false;
		$scope.assignedFlight = null;
		$scope.flightId = null;

		return $scope.loadFlights()
		.then(function(flights) {
			// fallback local si no hay vuelos remotos
			if (!flights || flights.length === 0) {
				console.warn('assignFlightAutomatically: no hay vuelos remotos, usar fallback local');
				return SeatService.getSeats().then(function(localSeats){
					$scope.seats = localSeats || [];
					var disponiblesLocal = ($scope.seats || []).filter(function(s){ return seatMatchesClassAndAvailable(s); });
					if (disponiblesLocal.length >= $scope.cantidad) {
						$scope.flightId = 0;
						$scope.assignedFlight = { id: 0, flight_code: 'LOCAL-FALLBACK' };
						applyAutoSelectionIfNeeded();
						if(!$scope.$$phase) $scope.$apply();
						console.log('assignFlightAutomatically: asignado fallback local');
						return $scope.assignedFlight;
					}
					return Promise.reject(new Error('No hay vuelos (ni fallback) con suficientes asientos disponibles.'));
				});
			}

			// revisar asientos por cada vuelo remoto
			return Promise.all(flights.map(function(f) {
				return ReservationService.getSeats(f.id)
					.then(function(res) { return { flight: f, seats: res.data.seats || [] }; })
					.catch(function() { return { flight: f, seats: [] }; });
			}));
		})
		.then(function(results) {
			if (!results) return Promise.reject(new Error('Sin resultados de vuelos.'));
			var found = null;
			for (var i = 0; i < results.length; i++) {
				var entry = results[i];
				var disponibles = (entry.seats || []).filter(function(s){ return seatMatchesClassAndAvailable(s); });
				console.log('assignFlightAutomatically: vuelo', entry.flight.id, 'disponibles:', disponibles.length);
				if (disponibles.length >= $scope.cantidad) {
					found = entry.flight;
					$scope.seats = entry.seats;
					break;
				}
			}
			if (!found) {
				// intentar fallback local antes de fallar
				console.warn('assignFlightAutomatically: no encontrado en remotos, probando fallback local');
				return SeatService.getSeats().then(function(localSeats){
					$scope.seats = localSeats || [];
					var disponiblesLocal = ($scope.seats || []).filter(function(s){ return seatMatchesClassAndAvailable(s); });
					if (disponiblesLocal.length >= $scope.cantidad) {
						$scope.flightId = 0;
						$scope.assignedFlight = { id: 0, flight_code: 'LOCAL-FALLBACK' };
						applyAutoSelectionIfNeeded();
						if(!$scope.$$phase) $scope.$apply();
						console.log('assignFlightAutomatically: asignado fallback local (2)');
						return $scope.assignedFlight;
					}
					return Promise.reject(new Error('No se encontró ningún vuelo con suficientes asientos disponibles.'));
				});
			}
			// encontrado en remotos
			$scope.flightId = found.id;
			$scope.assignedFlight = found;
			console.log('assignFlightAutomatically: vuelo asignado automáticamente ->', found.id);
			applyAutoSelectionIfNeeded();
			if(!$scope.$$phase) $scope.$apply();
			return found;
		})
		.catch(function(err) {
			console.error('assignFlightAutomatically error:', err && err.message ? err.message : err);
			$scope.formStarted = false;
			return Promise.reject(err);
		});
	}

	// exponer startForm al scope apuntando a la implementación única
	$scope.startForm = assignFlightAutomatically;

	// ---- Helpers ----
	$scope.loadFlights = function() {
		return ReservationService.getFlights()
			.then(function(res) {
				$scope.flights = res.data.flights || [];
				console.log('loadFlights: vuelos cargados', $scope.flights.length);
				return $scope.flights;
			})
			.catch(function(err) {
				console.error('Error cargando vuelos', err);
				$scope.flights = [];
				return [];
			});
	};

	$scope.loadSeats = function() {
		console.log('loadSeats called, flightId=', $scope.flightId);
		if ($scope.flightId && $scope.flightId !== 0) {
			return ReservationService.getSeats($scope.flightId)
				.then(function(res) {
					$scope.seats = res.data.seats || [];
					console.log('loadSeats (remote): asientos cargados', $scope.seats.length);
					return $scope.seats;
				})
				.catch(function(err) {
					console.error('loadSeats (remote) error', err);
					return SeatService.getSeats().then(function(data){
						$scope.seats = data || [];
						return $scope.seats;
					});
				});
		}
		// fallback local o flightId === 0 pseudo-local
		return SeatService.getSeats().then(function(data){
			$scope.seats = data || [];
			console.log('loadSeats (local): asientos cargados', $scope.seats.length);
			return $scope.seats;
		});
	};

	// >>> REPLACE: mejor normalización y comprobación de disponibilidad
	function normalizeSeat(s) {
		if (!s) return null;
		// número y fila desde propiedades posibles
		let row = s.row || null;
		let number = (typeof s.number !== 'undefined' && s.number !== null) ? Number(s.number) : null;
		if (!number && s.seat_number) {
			// seat_number puede ser 'A1', '12', etc.
			const numMatch = String(s.seat_number).match(/(\d+)/);
			if (numMatch) number = parseInt(numMatch[1], 10);
			const rowMatch = String(s.seat_number).match(/^([A-Z]+)/i);
			if (rowMatch && !row) row = rowMatch[1].toUpperCase();
		}
		// clase explícita o inferida por número (fallback)
		let seat_class = s.seat_class || s.class || (number ? (number <= 2 ? 'business' : 'economy') : null);
		// ocupado: varios posibles campos
		let occupied = false;
		if (typeof s.is_occupied !== 'undefined') occupied = !!s.is_occupied;
		if (typeof s.occupied !== 'undefined') occupied = occupied || !!s.occupied;
		if (typeof s.status === 'string') {
			occupied = occupied || (s.status.toLowerCase() === 'reserved' || s.status.toLowerCase() === 'occupied' || s.status.toLowerCase() === 'unavailable');
		}
		return { raw: s, row, number, seat_class, occupied };
	}

	function seatMatchesClassAndAvailable(s) {
		const n = normalizeSeat(s);
		if (!n) return false;
		// si no conocemos clase, no contar como disponible
		if (!n.seat_class) return false;
		return n.seat_class === $scope.seat_class && !n.occupied;
	}

	function applyAutoSelectionIfNeeded() {
		// normalizar y filtrar sin modificar objetos originales
		const normalized = ($scope.seats || []).map(normalizeSeat).filter(Boolean);
		console.log('applyAutoSelectionIfNeeded -> normalized sample:', normalized.slice(0,4));
		const disponibles = normalized.filter(function(n){ return n.seat_class === $scope.seat_class && !n.occupied; });
		console.log('applyAutoSelectionIfNeeded -> disponibles count:', disponibles.length, 'for class', $scope.seat_class, 'required', $scope.cantidad);
		if (disponibles.length < $scope.cantidad) {
			// no suficiente
			return false;
		}
		if (!$scope.seleccion_manual) {
			// seleccionar objetos originales correspondientes a los normalizados
			$scope.asientosSeleccionados = disponibles.slice(0, $scope.cantidad).map(n => n.raw);
			console.log('applyAutoSelectionIfNeeded: asientos seleccionados automáticamente', $scope.asientosSeleccionados);
			
			// NUEVO: Inicializar datos de pasajeros para cada asiento automático
			$scope.asientosSeleccionados.forEach(function(seat) {
				if (!$scope.pasajerosPorAsiento[seat.id]) {
					$scope.pasajerosPorAsiento[seat.id] = {
						passenger_name: '',
						cui_full: '',
						has_luggage: false,
						reserved_at: null
					};
				}
			});

			// NUEVO: Abrir automáticamente el modal para el primer asiento seleccionado
			if ($scope.asientosSeleccionados.length > 0) {
				// Usar $timeout para asegurar que Angular procese el digest cycle
				setTimeout(function() {
					var primerAsiento = $scope.asientosSeleccionados[0];
					var seatId = primerAsiento.id || primerAsiento.seat_number;
					console.log('applyAutoSelectionIfNeeded: abriendo modal para primer asiento', seatId);
					$scope.openPassengerForm(seatId);
					if(!$scope.$$phase) $scope.$apply();
				}, 100);
			}
		}
		return true;
	}

	// NUEVO: Verificar que todos los asientos seleccionados tienen datos de pasajero
	$scope.todosAsientosTienenPasajero = function() {
		if (!$scope.asientosSeleccionados || $scope.asientosSeleccionados.length === 0) return false;
		
		for (var i = 0; i < $scope.asientosSeleccionados.length; i++) {
			var seat = $scope.asientosSeleccionados[i];
			var pasajero = $scope.pasajerosPorAsiento[seat.id];
			
			if (!pasajero || !pasajero.passenger_name || !pasajero.cui_full) {
				return false;
			}
		}
		return true;
	};

	// ---- Modal pasajero ----
	$scope.openPassengerForm = function(seatId) {
		console.log('openPassengerForm called, seatId=', seatId);
		if (seatId == null) return;
		if ($scope.isReservedId(seatId)) {
			console.log('openPassengerForm: seat is reserved, abort', seatId);
			return;
		}
		
		// Buscar el asiento para obtener información completa
		var seat = $scope.getSeat(seatId);
		if (!seat) {
			console.log('openPassengerForm: seat not found locally, loading seats...');
			$scope.loadSeats();
			return;
		}

		// Cargar datos existentes si ya hay información guardada
		var datosExistentes = $scope.pasajerosPorAsiento[seat.id] || {};
		
		$scope.modal = { 
			seatId: seat.id || seatId,
			seatNumber: seat.seat_number || seatId,
			passenger_name: datosExistentes.passenger_name || '', 
			cui_full: datosExistentes.cui_full || '', 
			has_luggage: datosExistentes.has_luggage || false, 
			reserved_at: datosExistentes.reserved_at || null, 
			error: null,
			cuiError: null,  // NUEVO: error específico del CUI
			cuiValid: false  // NUEVO: estado de validez del CUI
		};
		$scope.modalConfirmVisible = false;
		$scope.passengerModalVisible = true;
	};

	$scope.modalContinue = function() {
		console.log('modalContinue called, modal=', $scope.modal);
		$scope.modal.error = null;
		
		if (!$scope.modal.passenger_name || !$scope.modal.cui_full) { 
			$scope.modal.error = 'Nombre y CUI son requeridos'; 
			return; 
		}
		
		// MODIFICADO: Usar la validación completa del CUI
		var cuiValidation = validarCUIGuatemalteco($scope.modal.cui_full);
		if (!cuiValidation.valid) {
			$scope.modal.error = cuiValidation.message;
			return;
		}
		
		$scope.modal.reserved_at = new Date().toLocaleString();
		$scope.modalConfirmVisible = true;
	};

	// Al confirmar en modal, guardar asiento correctamente (usar búsqueda compatible)
	$scope.confirmPassengerSave = function() {
		console.log('confirmPassengerSave called, modal=', $scope.modal);
		var seat = $scope.getSeat($scope.modal.seatId);
		if (seat) {
			// evitar duplicados usando la misma comparación
			var exists = $scope.asientosSeleccionados.some(function(a){
				if (!a) return false;
				if (a.id && seat.id && a.id == seat.id) return true;
				if (a.seat_number && seat.seat_number && String(a.seat_number).toUpperCase() === String(seat.seat_number).toUpperCase()) return true;
				return false;
			});
			if (!exists) {
				$scope.asientosSeleccionados.push(seat);
				console.log('confirmPassengerSave: added seat to asientosSeleccionados', seat);
			} else {
				console.log('confirmPassengerSave: seat already selected', seat);
			}
			$scope.pasajerosPorAsiento[ (seat.id != null ? seat.id : seat.seat_number) ] = {
				passenger_name: $scope.modal.passenger_name,
				cui_full: $scope.modal.cui_full,
				has_luggage: !!$scope.modal.has_luggage,
				reserved_at: $scope.modal.reserved_at
			};
			console.log('confirmPassengerSave: pasajerosPorAsiento updated', $scope.pasajerosPorAsiento);
			
			// NUEVO: Si hay más asientos seleccionados sin datos, abrir el siguiente
			var siguienteAsientoSinDatos = $scope.asientosSeleccionados.find(function(s) {
				var p = $scope.pasajerosPorAsiento[s.id];
				return !p || !p.passenger_name || !p.cui_full;
			});
			
			if (siguienteAsientoSinDatos) {
				// Cerrar modal actual y abrir el siguiente
				$scope.closePassengerModal();
				setTimeout(function() {
					$scope.openPassengerForm(siguienteAsientoSinDatos.id || siguienteAsientoSinDatos.seat_number);
					if(!$scope.$$phase) $scope.$apply();
				}, 300);
			} else {
				// Todos los asientos tienen datos, solo cerrar
				$scope.closePassengerModal();
			}
		} else {
			$scope.modal.error = 'No se encontró el asiento seleccionado. Intenta recargar los asientos.';
			console.warn('confirmPassengerSave: seat not found for', $scope.modal.seatId);
			return;
		}
		$scope.closePassengerModal();
	};

	// util: buscar asiento por id o por seat_number (ej. "A1")
	$scope.getSeat = function(idOrSeatNumber) {
		if (!$scope.seats) return undefined;
		// buscar por id directo (== para permitir string/number) o por seat_number
		return $scope.seats.find(function(s){
			if (!s) return false;
			if (s.id == idOrSeatNumber) return true;
			if (s.seat_number && String(s.seat_number).toUpperCase() === String(idOrSeatNumber).toUpperCase()) return true;
			// también soportar caso local donde id === 'A1'
			if (String(s.id).toUpperCase() === String(idOrSeatNumber).toUpperCase()) return true;
			return false;
		});
	};

	// reservar si está ocupado (soporta remoto y local)
	$scope.isReservedId = function(idOrSeatNumber) {
		var s = $scope.getSeat(idOrSeatNumber);
		if (!s) return false;
		return (s.is_occupied === true) || (typeof s.status === 'string' && s.status.toLowerCase() === 'reserved');
	};

	// ya seleccionado (compara por id o seat_number)
	$scope.isSelectedId = function(idOrSeatNumber) {
		if (!$scope.asientosSeleccionados) return false;
		return $scope.asientosSeleccionados.some(function(a){
			if (!a) return false;
			if (a.id && idOrSeatNumber && a.id == idOrSeatNumber) return true;
			if (a.seat_number && idOrSeatNumber && String(a.seat_number).toUpperCase() === String(idOrSeatNumber).toUpperCase()) return true;
			if (String(a.id).toUpperCase() === String(idOrSeatNumber).toUpperCase()) return true;
			return false;
		});
	};

	// toggle por id/seatNumber (llama a toggleSeat con el objeto)
	$scope.toggleSeatById = function(idOrSeatNumber) {
		var s = $scope.getSeat(idOrSeatNumber);
		if (!s) return;
		$scope.toggleSeat(s);
	};

	// toggle por objeto seat (mantener comparación consistente)
	$scope.toggleSeat = function(seat) {
		if (!seat) return;
		// considerar ocupado por cualquiera de los campos
		if ((seat.is_occupied === true) || (typeof seat.status === 'string' && seat.status.toLowerCase() === 'reserved')) return;

		// encontrar índice por id o seat_number
		var idx = $scope.asientosSeleccionados.findIndex(function(a){
			if (!a) return false;
			if (a.id && seat.id && a.id == seat.id) return true;
			if (a.seat_number && seat.seat_number && String(a.seat_number).toUpperCase() === String(seat.seat_number).toUpperCase()) return true;
			if (String(a.id).toUpperCase && String(seat.id).toUpperCase && String(a.id).toUpperCase() === String(seat.id).toUpperCase()) return true;
			return false;
		});
		if (idx >= 0) {
			$scope.asientosSeleccionados.splice(idx, 1);
		} else if ($scope.asientosSeleccionados.length < $scope.cantidad) {
			$scope.asientosSeleccionados.push(seat);
		}
	};

	// ---- Confirmación y envío de reserva ----
	$scope.confirmarSeleccion = function() {
		console.log('confirmarSeleccion called');
		if ($scope.asientosSeleccionados.length === 0) { 
			alert('No has seleccionado asientos.'); 
			return; 
		}
		
		// NUEVO: Verificar que todos los asientos tienen datos completos
		var todosCompletos = $scope.asientosSeleccionados.every(function(seat) {
			var p = $scope.pasajerosPorAsiento[seat.id];
			return p && p.passenger_name && p.cui_full;
		});
		
		if (!todosCompletos) {
			alert('Por favor, completa los datos de todos los pasajeros antes de confirmar.');
			return;
		}
		
		var token = localStorage.getItem('token');
		var userEmail = localStorage.getItem('userEmail');
		console.log('confirmarSeleccion: token present=', !!token, 'userEmail=', userEmail);

		if (!token) { 
			alert('Debes iniciar sesión para realizar la reserva.'); 
			return; 
		}

		// Usar assignFlightAutomatically si no hay flightId
		var ensureFlightPromise = $scope.flightId ? Promise.resolve($scope.flightId) : assignFlightAutomatically();

		ensureFlightPromise
			.then(function() {
				// construir payload - CORREGIDO: usar el valor correcto de seleccion_manual
				var payload = {
					flight_id: $scope.flightId ? parseInt($scope.flightId,10) : null,
					cantidad: $scope.asientosSeleccionados.length,
					seat_class: $scope.seat_class || 'economy',
					seleccion_manual: !!$scope.seleccion_manual,
					asientos: $scope.asientosSeleccionados.map(function(s){
						var p = $scope.pasajerosPorAsiento[s.id] || {};
						return { 
							seat_id: s.id, 
							passenger_name: p.passenger_name || '', 
							cui_full: p.cui_full || '', 
							has_luggage: !!p.has_luggage 
						};
					}),
					email: userEmail || undefined
				};

				console.log('confirmarSeleccion: built payload', JSON.stringify(payload, null, 2));

				// Guardar payload para uso en el catch si hace falta
				$scope._lastReservationPayload = payload;

				// fallback local -> guardar offline en vez de enviar
				if ($scope.flightId === 0 || !payload.flight_id) {
					if (confirm('No hay vuelos con asientos disponibles en el servidor. ¿Deseas guardar la reserva localmente?')) {
						$scope.saveOfflineReservation(payload);
						return Promise.reject(new Error('Fallback local - saved offline'));
					}
					return Promise.reject(new Error('Usuario canceló reserva local'));
				}

				console.log('confirmarSeleccion: enviando payload al backend');
				return ReservationService.createMultiReservation(payload);
			})
			.then(function(res) {
				if (!res) return;
				console.log('confirmarSeleccion: backend response', res);
				
				// NUEVO: Manejo mejorado de respuesta con envío de email fallido
				if (res.data && res.data.success) {
					if (res.data.email_sent) {
						alert('¡Reserva realizada con éxito! Se ha enviado un correo con el detalle.');
					} else {
						alert('Reserva realizada con éxito, pero no se pudo enviar el correo de confirmación. ' +
						      'Puedes ver los detalles en el reporte de reservas.');
					}
				} else {
					alert('Reserva realizada con éxito.');
				}
				
				$scope.asientosSeleccionados = [];
				$scope.pasajerosPorAsiento = {};
				$scope.showResumen = false;
				$scope.formStarted = false;
				$scope.loadSeats();
			})
			.catch(function(err) {
				// manejar casos controlados
				if (err && (err.message === 'Fallback local - saved offline' || err.message === 'Usuario canceló reserva local')) {
					console.warn('Reserva detenida:', err.message);
					return;
				}

				// Si es error HTTP 500, revisar body para ver si fue fallo de envío de correo
				if (err && err.status === 500) {
					console.error('confirmarSeleccion error 500, body:', err.data);
					// heurística: buscar palabras claves que indiquen fallo de email
					var bodyStr = '';
					try { bodyStr = JSON.stringify(err.data).toLowerCase(); } catch(e){ bodyStr = String(err.data || '').toLowerCase(); }
					var mentionsEmail = /email|correo|mail|smtp|nodemailer|preview|mensaje/i.test(bodyStr);
					// intentar extraer reservation id de varios formatos
					var reservationId = null;
					try {
						if (err.data && err.data.reservation_id) reservationId = err.data.reservation_id;
						else if (err.data && err.data.reservation && (err.data.reservation.id || err.data.reservation._id)) reservationId = err.data.reservation.id || err.data.reservation._id;
						else if (err.data && err.data.id) reservationId = err.data.id;
						else if (err.data && err.data._id) reservationId = err.data._id;
						if (!reservationId && bodyStr) {
							var m = bodyStr.match(/reservation[_\s-]?id["']?\s*[:=]\s*["']?([a-z0-9\-]+)["']?/i);
							if (m) reservationId = m[1];
						}
					} catch(e) { reservationId = null; }

					if (mentionsEmail) {
						// Informar usuario y ofrecer reintento si tenemos reservationId
						if (reservationId) {
							if (confirm('La reserva fue procesada pero falló el envío del correo. ¿Deseas reintentar enviar el correo ahora?')) {
								ReservationService.resendReservationEmail(reservationId)
									.then(function(rres) {
										alert('Reintento realizado: ' + (rres.data && rres.data.message ? rres.data.message : 'Correo reenviado si fue posible.'));
									})
									.catch(function(rerr) {
										console.error('Resend email error', rerr);
										// guardar payload local para soporte si falla reintento
										$scope.saveOfflineReservation($scope._lastReservationPayload);
										alert('No se pudo reintentar el envío del correo. La reserva se ha guardado localmente para soporte.');
									});
							} else {
								// usuario no quiere reintentar ahora -> guardar para soporte
								$scope.saveOfflineReservation($scope._lastReservationPayload);
								alert('La reserva fue procesada. Se ha guardado localmente para reintento por soporte.');
							}
							$scope.loadSeats();
							return;
						} else {
							// no hay id, guardar payload localmente (tener evidencia para soporte)
							$scope.saveOfflineReservation($scope._lastReservationPayload);
							alert('La reserva fue procesada, pero no se pudo enviar el correo de confirmación. Se ha guardado la información localmente para soporte.');
							$scope.loadSeats();
							return;
						}
					}
					// si no menciona email, mostrar mensaje genérico con info
					alert('Error interno del servidor al procesar la reserva. Revisa la consola para más detalles.');
					return;
				}

				// manejar otros errores HTTP
				if (err && err.status) {
					console.error('confirmarSeleccion error status:', err.status, 'data:', err.data);
					if (err.status === 401 || err.status === 403) {
						alert('No autorizado. Inicia sesión nuevamente.');
						return;
					}
					if (err.status === 409) {
						alert('Algunos asientos ya no están disponibles. Actualizando asientos, por favor revisa y vuelve a intentar.');
						$scope.loadSeats().then(function(){
							assignFlightAutomatically().catch(function(){});
						});
						return;
					}
					// otros status -> mostrar body si existe
					alert('Error del servidor: ' + err.status + ' - ' + (err.data && err.data.error ? err.data.error : JSON.stringify(err.data)));
					return;
				}

				// fallback mensaje
				var msg = err && err.data && err.data.error ? err.data.error : (err && err.message ? err.message : 'Error al crear la reserva');
				alert(msg);
				console.error('confirmarSeleccion unknown error:', err);
			});
	};

	// NUEVO: Validación completa del CUI guatemalteco con módulo 11
	function validarCUIGuatemalteco(cui) {
		if (!cui) {
			return { valid: false, message: 'CUI vacío' };
		}

		cui = cui.replace(/\s/g, '');
		var cuiRegExp = /^[0-9]{13}$/;
		if (!cuiRegExp.test(cui)) {
			return { valid: false, message: 'CUI debe tener 13 dígitos numéricos' };
		}

		var depto = parseInt(cui.substring(9, 11), 10);
		var muni = parseInt(cui.substring(11, 13), 10);
		var numero = cui.substring(0, 8);
		var verificador = parseInt(cui.substring(8, 9), 10);
		var munisPorDepto = [17, 8, 16, 16, 13, 14, 19, 8, 24, 21, 9, 30, 32, 21, 8, 17, 14, 5, 11, 11, 7, 17];

		if (depto === 0 || muni === 0) {
			return { valid: false, message: 'Código de departamento o municipio inválido' };
		}

		if (depto > munisPorDepto.length) {
			return { valid: false, message: 'Código de departamento no existe (01-22)' };
		}

		if (muni > munisPorDepto[depto - 1]) {
			return { valid: false, message: 'Código de municipio inválido para el departamento ' + (depto < 10 ? '0' + depto : depto) };
		}

		var total = 0;
		for (var i = 0; i < numero.length; i++) {
			total += parseInt(numero[i], 10) * (i + 2);
		}

		var modulo = total % 11;
		
		if (modulo !== verificador) {
			return { valid: false, message: 'Dígito verificador incorrecto' };
		}

		return { valid: true, message: 'CUI válido' };
	}

	// NUEVO: Validar CUI en tiempo real
	$scope.validateCUIRealTime = function() {
		if (!$scope.modal.cui_full || $scope.modal.cui_full.length === 0) {
			$scope.modal.cuiError = null;
			$scope.modal.cuiValid = false;
			return;
		}

		var result = validarCUIGuatemalteco($scope.modal.cui_full);
		
		if (result.valid) {
			$scope.modal.cuiError = null;
			$scope.modal.cuiValid = true;
		} else {
			$scope.modal.cuiError = result.message;
			$scope.modal.cuiValid = false;
		}
	};

	// Función para navegar al reporte
	$scope.verReporte = function() {
		$location.path('/report');
	};

	// Inicializar asientos
	$scope.loadFlights();
	$scope.loadSeats();
}])
.controller('LoginController', ['$scope', 'AuthService', '$location', '$timeout', function($scope, AuthService, $location, $timeout) {
    $scope.user = {};
    $scope.error = null;
    $scope.isRegister = false;
    $scope.loading = false;
    $scope.successMsg = null;
    $scope.emailError = null;

    $scope.validateEmail = function() {
        const email = $scope.user.email;
        
        if (!email || email.trim() === '') {
            $scope.emailError = 'El email es requerido';
            return false;
        }

        const validDomains = /@(gmail\.com|outlook\.com)$/i;
        if (!validDomains.test(email)) {
            $scope.emailError = 'Por favor ingresa un correo válido de Gmail o Outlook';
            return false;
        }

        $scope.emailError = null;
        return true;
    };

    // Watch para validar email cuando cambie
    $scope.$watch('user.email', function(newVal) {
        if (newVal) {
            $scope.validateEmail();
        }
    });

    $scope.submit = function() {
        if (!$scope.validateEmail()) {
            return;
        }

        $scope.loading = true;
        $scope.error = null;
        $scope.successMsg = null;
        const action = $scope.isRegister ? AuthService.register : AuthService.login;
        action($scope.user)
        .then(function(response) {
            if ($scope.isRegister) {
                $scope.successMsg = "Usuario creado exitosamente. Ahora puedes iniciar sesión.";
                $scope.user = {};
                $timeout(function() { $scope.successMsg = null; }, 3000);
            } else {
                localStorage.setItem('token', response.data.token);
                localStorage.setItem('userEmail', response.data.user.email);
                $location.path('/');
            }
        })
        .catch(function(error) {
            $scope.error = error.data ? error.data.error : 'Error de conexión con el servidor';
        })
        .finally(function() {
            $scope.loading = false;
        });
    };

    // Watch para validar email cuando cambia modo registro/login
    $scope.$watch('isRegister', function() {
        if ($scope.user.email) {
            $scope.validateEmail($scope.user.email);
        }
    });
}])
.controller('FlightsController', ['$scope', 'ReservationService', function($scope, ReservationService) {
    $scope.loadingFlights = true;
    $scope.flights = [];
    ReservationService.getFlights()
      .then(function(res) {
        $scope.flights = res.data.flights || [];
      })
      .catch(function(err) {
        console.error('Error getting flights', err);
      })
      .finally(function() { $scope.loadingFlights = false; });
}])
.controller('ReserveController', ['$scope', '$routeParams', 'ReservationService', '$location', function($scope, $routeParams, ReservationService, $location) {
    $scope.flightId = $routeParams.flightId;
    $scope.seats = [];
    $scope.selectedSeat = null;
    $scope.passenger = { passenger_name: '', cui_full: '', has_luggage: false, price: 0 };
    $scope.error = null;
    $scope.loading = true;

    $scope.formStarted = false;
    $scope.cantidad = 1;
    $scope.seat_class = 'economy';
    $scope.seleccion_manual = true;

    // Validación completa del CUI
    function validarCUIGuatemalteco(cui) {
		if (!cui) return { valid: false, message: 'CUI vacío' };
		cui = cui.replace(/\s/g, '');
		if (!/^[0-9]{13}$/.test(cui)) return { valid: false, message: 'CUI debe tener 13 dígitos' };
		
		var depto = parseInt(cui.substring(9, 11), 10);
		var muni = parseInt(cui.substring(11, 13), 10);
		var numero = cui.substring(0, 8);
		var verificador = parseInt(cui.substring(8, 9), 10);
		var munisPorDepto = [17, 8, 16, 16, 13, 14, 19, 8, 24, 21, 9, 30, 32, 21, 8, 17, 14, 5, 11, 11, 7, 17];
		
		if (depto === 0 || muni === 0) return { valid: false, message: 'Código inválido' };
		if (depto > munisPorDepto.length) return { valid: false, message: 'Departamento inválido' };
		if (muni > munisPorDepto[depto - 1]) return { valid: false, message: 'Municipio inválido' };
		
		var total = 0;
		for (var i = 0; i < numero.length; i++) {
			total += parseInt(numero[i], 10) * (i + 2);
		}
		
		if ((total % 11) !== verificador) return { valid: false, message: 'Dígito verificador incorrecto' };
		return { valid: true, message: 'CUI válido' };
	}

    $scope.onFormChange = function() {
      $scope.seatsDisponibles = $scope.seats.filter(s => s.seat_class === $scope.seat_class && !s.is_occupied);
      if (!$scope.seleccion_manual && $scope.seatsDisponibles.length >= $scope.cantidad) {
        $scope.asientosSeleccionados = $scope.seatsDisponibles.slice(0, $scope.cantidad);
      } else {
        $scope.asientosSeleccionados = [];
      }
      $scope.pasajeros = [];
      $scope.currentIndex = 0;
      $scope.confirmaciones = [];
      $scope.showPassengerForm = false;
      $scope.showResumen = false;
      $scope.showSuccess = false;
      $scope.error = null;
    };

    ReservationService.getSeats($scope.flightId)
      .then(function(res) {
        $scope.seats = res.data.seats || [];
        $scope.onFormChange();
      })
      .catch(function(err) {
        $scope.error = 'No se pudieron cargar los asientos';
      })
      .finally(function() { $scope.loading = false; });

    $scope.startForm = function() {
      $scope.formStarted = true;
      $scope.asientosSeleccionados = [];
      $scope.pasajeros = [];
      $scope.currentIndex = 0;
      $scope.confirmaciones = [];
      $scope.showPassengerForm = false;
      $scope.showResumen = false;
      $scope.showSuccess = false;
      
      $scope.seatsDisponibles = $scope.seats.filter(s => s.seat_class === $scope.seat_class && !s.is_occupied);
      if ($scope.seatsDisponibles.length < $scope.cantidad) {
        $scope.error = "No hay suficientes asientos disponibles.";
        $scope.formStarted = false;
        return;
      }
      
      if ($scope.seleccion_manual) {
        $scope.asientosSeleccionados = [];
      } else {
        $scope.asientosSeleccionados = $scope.seatsDisponibles.slice(0, $scope.cantidad);
        $scope.initPasajeros();
        $scope.showPassengerForm = true;
      }
    };

    $scope.toggleSeat = function(seat) {
      if (seat.is_occupied) return;
      const idx = $scope.asientosSeleccionados.findIndex(s => s.id === seat.id);
      if (idx >= 0) {
        $scope.asientosSeleccionados.splice(idx, 1);
      } else if ($scope.asientosSeleccionados.length < $scope.cantidad) {
        $scope.asientosSeleccionados.push(seat);
      }
    };

    $scope.confirmManualSeats = function() {
      if ($scope.asientosSeleccionados.length !== $scope.cantidad) {
        $scope.error = "Selecciona exactamente " + $scope.cantidad + " asientos.";
        return;
      }
      $scope.initPasajeros();
      $scope.showPassengerForm = true;
    };

    $scope.initPasajeros = function() {
      $scope.pasajeros = [];
      for (let i = 0; i < $scope.cantidad; i++) {
        $scope.pasajeros.push({ passenger_name: '', cui_full: '', has_luggage: false });
      }
      $scope.currentIndex = 0;
      $scope.confirmaciones = [];
    };

    $scope.confirmarPasajero = function() {
      const p = $scope.pasajeros[$scope.currentIndex];
      if (!p.passenger_name || !p.cui_full) {
        $scope.error = "Nombre y CUI requeridos.";
        return;
      }
      
      var cuiValidation = validarCUIGuatemalteco(p.cui_full);
      if (!cuiValidation.valid) {
        $scope.error = cuiValidation.message;
        return;
      }
      
      $scope.error = null;
      const seat = $scope.asientosSeleccionados[$scope.currentIndex];
      $scope.confirmaciones[$scope.currentIndex] = {
        seat_number: seat.seat_number,
        fecha: new Date().toLocaleString()
      };
      
      if ($scope.currentIndex < $scope.cantidad - 1) {
        if (confirm("¿Deseas continuar con la reserva del siguiente asiento?")) {
          $scope.currentIndex++;
        }
      } else {
        $scope.showPassengerForm = false;
        $scope.showResumen = true;
        $scope.precio_unitario = $scope.seat_class === 'business' ? $scope.seatsDisponibles[0].business_price : $scope.seatsDisponibles[0].economy_price;
        $scope.precio_total = $scope.precio_unitario * $scope.cantidad;
      }
    };

    $scope.modificarPasajero = function(idx) {
      $scope.currentIndex = idx;
      $scope.showResumen = false;
      $scope.showPassengerForm = true;
    };

    $scope.enviarReserva = function() {
      const payload = {
        flight_id: parseInt($scope.flightId, 10),
        cantidad: $scope.cantidad,
        seat_class: $scope.seat_class,
        seleccion_manual: $scope.seleccion_manual,
        asientos: $scope.asientosSeleccionados.map((s, i) => ({
          seat_id: s.id,
          passenger_name: $scope.pasajeros[i].passenger_name,
          cui_full: $scope.pasajeros[i].cui_full,
          has_luggage: $scope.pasajeros[i].has_luggage
        })),
        email: $scope.email
      };
      
      ReservationService.createMultiReservation(payload)
        .then(function(res) {
          $scope.showResumen = false;
          $scope.showSuccess = true;
        })
        .catch(function(err) {
          $scope.error = err.data && err.data.error ? err.data.error : 'Error al crear la reserva';
        });
    };
}])
.factory('SeatService', ['$q', function($q) {
    let seats = [];
    const rows = ['A','B','C','D','E','F','G','H','I'];
    for (let r of rows) {
        for (let n = 1; n <= 7; n++) {
            seats.push({ id: r + n, row: r, number: n, status: 'available' });
        }
    }

    return {
        getSeats: function() {
            var result = seats.map(seat => ({...seat}));
            console.log('SeatService.getSeats called, returning', result.length, 'seats');
            return $q.when(result);
        },
        saveSeats: function(newSeats) {
            seats = newSeats.map(seat => ({...seat}));
        }
    };
}])
.service('AuthService', ['$http', 'API_URL', function($http, API_URL) {
    this.login = function(credentials) {
      return $http.post(API_URL + '/login', credentials);
    };
    
    this.register = function(userData) {
      return $http.post(API_URL + '/register', userData);
    };
    
    this.logout = function() {
      localStorage.removeItem('token');
      localStorage.removeItem('userEmail');
    };
    
    this.getUserEmail = function() {
      return localStorage.getItem('userEmail');
    };
}])
.run(['$rootScope', 'AuthService', '$location', function($rootScope, AuthService, $location) {
    $rootScope.getUserEmail = AuthService.getUserEmail;
    $rootScope.logout = function() {
      AuthService.logout();
      $location.path('/login');
    };
    
    // Redirigir a login si no está autenticado
    $rootScope.$on('$routeChangeStart', function(event, next, current) {
        var isLoggedIn = !!localStorage.getItem('token');
        var isLoginPage = next && next.$$route && next.$$route.originalPath === '/login';
        
        if (!isLoggedIn && !isLoginPage) {
            event.preventDefault();
            $location.path('/login');
        }
    });
}])
.controller('ReportController', ['$scope', '$http', 'API_URL', '$location', 'ReservationService', function($scope, $http, API_URL, $location, ReservationService) {
	$scope.reservations = [];
	$scope.statistics = null;
	$scope.flights = [];
	$scope.selectedFlight = null;
	$scope.flightSeats = [];
	$scope.loading = true;
	$scope.loadingStats = true;
	$scope.loadingSeats = false;
	$scope.error = null;
	$scope.showDiagram = false;

	// Cargar reservas del usuario
	$scope.loadReservations = function() {
		const token = localStorage.getItem('token');
		if (!token) {
			$scope.error = 'Debes iniciar sesión para ver las reservas';
			$scope.loading = false;
			return;
		}

		$http.get(API_URL + '/reservations', { headers: { Authorization: 'Bearer ' + token } })
			.then(function(res) {
				$scope.reservations = res.data.reservations || [];
				console.log('Reservas cargadas:', $scope.reservations.length);
			})
			.catch(function(err) {
				console.error('Error cargando reservas:', err);
				$scope.error = err.data && err.data.error ? err.data.error : 'Error al cargar reservas';
			})
			.finally(function() {
				$scope.loading = false;
			});
	};

	// NUEVO: Cargar estadísticas del sistema
	$scope.loadStatistics = function() {
		const token = localStorage.getItem('token');
		if (!token) {
			$scope.loadingStats = false;
			return;
		}

		$http.get(API_URL + '/statistics', { headers: { Authorization: 'Bearer ' + token } })
			.then(function(res) {
				$scope.statistics = res.data;
				console.log('Estadísticas cargadas:', $scope.statistics);
			})
			.catch(function(err) {
				console.error('Error cargando estadísticas:', err);
			})
			.finally(function() {
				$scope.loadingStats = false;
			});
	};

	// NUEVO: Cargar vuelos para el diagrama
	$scope.loadFlights = function() {
		ReservationService.getFlights()
			.then(function(res) {
				$scope.flights = res.data.flights || [];
			})
			.catch(function(err) {
				console.error('Error cargando vuelos:', err);
			});
	};

	// NUEVO: Cargar asientos de un vuelo específico
	$scope.loadFlightSeats = function() {
		if (!$scope.selectedFlight) return;
		
		$scope.loadingSeats = true;
		ReservationService.getSeats($scope.selectedFlight.id)
			.then(function(res) {
				$scope.flightSeats = res.data.seats || [];
				$scope.showDiagram = true;
			})
			.catch(function(err) {
				console.error('Error cargando asientos del vuelo:', err);
			})
			.finally(function() {
				$scope.loadingSeats = false;
			});
	};

	// NUEVO: Verificar si un asiento está ocupado
	$scope.isSeatOccupied = function(seat) {
		return seat && seat.is_occupied === true;
	};

	// NUEVO: Obtener clase CSS para el asiento
	$scope.getSeatClass = function(seat) {
		if (!seat) return '';
		if (seat.is_occupied) return 'occupied';
		return 'available';
	};

	$scope.volver = function() {
		$location.path('/');
	};

	// Cargar todo al iniciar
	$scope.loadReservations();
	$scope.loadStatistics();
	$scope.loadFlights();
}]);