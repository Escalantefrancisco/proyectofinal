# Airplane Seat Reservation Application

This project is an airplane seat reservation application built using AngularJS. It allows users to reserve seats, view reserved seats, and generate reports on seat reservations.

## Project Structure

```
airplane-seat-reservation-app
├── src
│   ├── index.html          # Main HTML file serving as the entry point
│   ├── app.js              # Initializes the AngularJS application
│   ├── controllers
│   │   └── seatController.js # Manages seat reservation logic
│   ├── services
│   │   └── seatService.js   # Handles data operations for seat reservations
│   ├── styles
│   │   └── styles.css       # CSS styles for the application
│   ├── views
│   │   ├── seatReservation.html # Layout for seat reservation interface
│   │   └── report.html      # Layout for displaying reports of reserved seats
│   └── assets
│       └── seats.json       # Initial data for seats
├── package.json             # Configuration file for npm
└── README.md                # Documentation for the project
```

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd airplane-seat-reservation-app
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Run the application:**
   You can use a local server to serve the `index.html` file. For example, you can use the `http-server` package:
   ```
   npx http-server src
   ```

4. **Access the application:**
   Open your web browser and navigate to `http://localhost:8080` (or the port specified by your server).

## Usage

- **Seat Reservation:** Navigate to the seat reservation interface to select and reserve seats.
- **View Reserved Seats:** Check the report page to view all reserved seats and their details.
- **Generate Reports:** Use the report functionality to generate and view reports on seat reservations.

## Contributing

Feel free to submit issues or pull requests for improvements or bug fixes.