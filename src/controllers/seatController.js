class SeatController {
    constructor($scope, seatService) {
        this.$scope = $scope;
        this.seatService = seatService;
        this.reservedSeats = [];
        this.loadReservedSeats();
    }

    reserveSeat(seatNumber) {
        if (!this.reservedSeats.includes(seatNumber)) {
            this.reservedSeats.push(seatNumber);
            this.seatService.saveReservedSeats(this.reservedSeats);
        } else {
            alert("Seat already reserved.");
        }
    }

    loadReservedSeats() {
        this.reservedSeats = this.seatService.getReservedSeats();
    }

    generateReport() {
        return this.reservedSeats.map(seat => {
            return { seatNumber: seat, status: 'reserved' };
        });
    }
}

angular.module('airplaneSeatReservationApp').controller('SeatController', SeatController);