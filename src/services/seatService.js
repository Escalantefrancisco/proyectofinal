class SeatService {
    constructor() {
        this.seats = [];
        this.loadSeats();
    }

    loadSeats() {
        fetch('assets/seats.json')
            .then(response => response.json())
            .then(data => {
                this.seats = data;
            })
            .catch(error => console.error('Error loading seats:', error));
    }

    saveReservedSeats(reservedSeats) {
        this.seats.forEach(seat => {
            if (reservedSeats.includes(seat.id)) {
                seat.status = 'reserved';
            }
        });
        this.saveSeatsToFile();
    }

    saveSeatsToFile() {
        // This function would typically send the updated seats data to a server
        // For this example, we will just log the updated seats
        console.log('Updated seats:', this.seats);
    }

    getReservedSeats() {
        return this.seats.filter(seat => seat.status === 'reserved');
    }

    generateReport() {
        const reservedSeats = this.getReservedSeats();
        return reservedSeats.map(seat => ({
            id: seat.id,
            class: seat.class,
            status: seat.status
        }));
    }
}

export default new SeatService();