# Datenschutzerklärung – gtasks-cloudrun

Stand: November 2026

## Zweck
gtasks-cloudrun ist ein privat betriebener MCP-Server. Er verbindet genau ein Google-Konto (das des Betreibers) mit Claude, damit Claude Google Tasks lesen und bearbeiten kann. Andere Personen können sich nicht anmelden.

## Welche Daten verarbeitet werden
- **Google-Anmeldung:** Bei der Anmeldung erhält der Server von Google die E-Mail-Adresse, um zu prüfen, ob sie freigeschaltet ist, sowie ein Refresh-Token für Google Tasks.
- **Google Tasks:** Aufgaben und Aufgabenlisten werden nur auf Anfrage abgerufen oder geändert und direkt an Claude weitergegeben.

## Speicherung
Der Server hat keine Datenbank und speichert keine Aufgaben. Das Google-Refresh-Token wird verschlüsselt im Zugriffstoken für Claude abgelegt, nicht auf dem Server.

## Protokolle
Google Cloud Run protokolliert technische Zugriffsdaten (Zeitpunkt, aufgerufene Adresse, Statuscode, IP-Adresse) in Google Cloud Logging. Diese werden nur zur Fehlersuche genutzt und nach den Standardfristen von Google gelöscht.

## Weitergabe
Es werden keine Daten an Dritte weitergegeben. Beteiligt sind nur Google (Hosting, Anmeldung, Tasks-API) und Anthropic (Claude als Client).

## Widerruf
Der Zugriff kann jederzeit unter https://myaccount.google.com/permissions widerrufen werden.

## Kontakt
tobias.me99+gtask@gmail.com
