# Bella Customers Orders

Read-only React app for browsing Bella Boutique customers, their orders, purchases, requested items, shipments, deliveries, package tasks, and receipts.

The app uses the same Firebase Web config and shared Firestore collections as the Bella Boutique Management app. It subscribes with anonymous auth and does not call Firestore write APIs.

## Setup

Copy the Firebase values from the reference app into `.env.local` using the same `REACT_APP_FIREBASE_*` names, then run:

```sh
npm install
npm run build
npm run dev
```

## Read-only collections

- `customers`
- `orders`
- `purchases`
- `requestedItems`
- `shipments`
- `deliveries`
- `packageTasks`

