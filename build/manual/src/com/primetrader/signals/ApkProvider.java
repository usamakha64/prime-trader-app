package com.primetrader.signals;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Minimal FileProvider-style ContentProvider for serving the downloaded update APK.
 * Serves ONLY files inside the app-private external files dir (getExternalFilesDir),
 * so there is no path-traversal risk and no storage permission needed.
 *
 * URI form: content://com.primetrader.signals.fileprovider/updates/<filename>
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.primetrader.signals.fileprovider";
    private static final int UPDATES = 1;
    private static final UriMatcher MATCHER = new UriMatcher(UriMatcher.NO_MATCH);

    static {
        MATCHER.addURI(AUTHORITY, "updates/*", UPDATES);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /** Resolve the requested file, confined to our external files dir. */
    private File resolveFile(Uri uri) throws FileNotFoundException {
        if (MATCHER.match(uri) != UPDATES) {
            throw new FileNotFoundException("Unsupported URI: " + uri);
        }
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("..") || name.contains("/") || name.contains("\\")) {
            throw new FileNotFoundException("Invalid name: " + name);
        }
        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (base == null) {
            throw new FileNotFoundException("External storage unavailable");
        }
        File f = new File(base, name);
        if (!f.isFile()) {
            throw new FileNotFoundException("Not found: " + name);
        }
        return f;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        try {
            File f = resolveFile(uri);
            String[] cols = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            MatrixCursor c = new MatrixCursor(cols, 1);
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException e) {
            return null;
        }
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolveFile(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read-only");
    }
}
