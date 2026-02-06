"""Export service for generating CSV files from event data."""

import csv
import io
import re
from datetime import UTC, datetime

from app.models.event import Event
from app.models.play_history import PlayHistory
from app.models.request import Request


def sanitize_csv_value(value: str | None) -> str:
    """
    Sanitize a value to prevent CSV formula injection.

    Spreadsheet applications (Excel, Google Sheets) interpret cells starting with
    =, +, -, @, \t, or \r as formulas, which can be exploited for attacks.
    Prefixing with a single quote prevents formula execution.
    """
    if not value:
        return ""
    if value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def sanitize_filename(name: str) -> str:
    """Sanitize a string for use in a filename."""
    # Remove or replace characters that are problematic in filenames
    sanitized = re.sub(r'[<>:"/\\|?*]', "", name)
    # Replace spaces with underscores
    sanitized = sanitized.replace(" ", "_")
    # Limit length
    return sanitized[:50]


def generate_export_filename(event: Event) -> str:
    """Generate a sanitized filename for CSV export."""
    sanitized_name = sanitize_filename(event.name)
    date_str = datetime.now(UTC).strftime("%Y%m%d")
    return f"{event.code}_{sanitized_name}_{date_str}.csv"


def export_requests_to_csv(event: Event, requests: list[Request]) -> str:
    """
    Export song requests to CSV format.

    Args:
        event: The event the requests belong to
        requests: List of requests to export

    Returns:
        CSV content as a string
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow(
        [
            "Request ID",
            "Song Title",
            "Artist",
            "Status",
            "Note",
            "Source",
            "Source URL",
            "Created At",
            "Updated At",
        ]
    )

    # Write data rows with sanitization to prevent CSV formula injection
    for req in requests:
        writer.writerow(
            [
                req.id,
                sanitize_csv_value(req.song_title),
                sanitize_csv_value(req.artist),
                req.status,
                sanitize_csv_value(req.note),
                sanitize_csv_value(req.source),
                sanitize_csv_value(req.source_url),
                req.created_at.isoformat() if req.created_at else "",
                req.updated_at.isoformat() if req.updated_at else "",
            ]
        )

    return output.getvalue()


def generate_play_history_export_filename(event: Event) -> str:
    """Generate a sanitized filename for play history CSV export."""
    sanitized_name = sanitize_filename(event.name)
    date_str = datetime.now(UTC).strftime("%Y%m%d")
    return f"{event.code}_{sanitized_name}_play_history_{date_str}.csv"


def _format_source_for_display(source: str) -> str:
    """Format source field for user-friendly display."""
    if source == "stagelinq":
        return "Live"
    elif source == "manual":
        return "Manual"
    return source


def _format_was_requested(matched_request_id: int | None) -> str:
    """Format Was Requested column based on matched_request_id."""
    return "Yes" if matched_request_id is not None else "No"


def export_play_history_to_csv(event: Event, history_items: list[PlayHistory]) -> str:
    """
    Export play history to CSV format.

    Args:
        event: The event the history belongs to
        history_items: List of play history entries to export

    Returns:
        CSV content as a string
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow(
        [
            "Play Order",
            "Title",
            "Artist",
            "Album",
            "Source",
            "Was Requested",
            "Started At",
            "Ended At",
        ]
    )

    # Write data rows with sanitization to prevent CSV formula injection
    for item in history_items:
        writer.writerow(
            [
                item.play_order,
                sanitize_csv_value(item.title),
                sanitize_csv_value(item.artist),
                sanitize_csv_value(item.album),
                _format_source_for_display(item.source),
                _format_was_requested(item.matched_request_id),
                item.started_at.isoformat() if item.started_at else "",
                item.ended_at.isoformat() if item.ended_at else "",
            ]
        )

    return output.getvalue()
