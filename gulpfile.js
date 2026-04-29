import gulp from 'gulp';
import plumber from 'gulp-plumber';
import gulpIf from 'gulp-if';

import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';

import postcss from 'gulp-postcss';
import postUrl from 'postcss-url';
import autoprefixer from 'autoprefixer';
import csso from 'postcss-csso';

import htmlmin from 'gulp-htmlmin';
import rename from 'gulp-rename';
import terser from 'gulp-terser';

import { deleteAsync } from 'del';
import browser from 'browser-sync';
import { exec } from 'child_process';

import svgo from 'gulp-svgmin';
import svgstore from 'gulp-svgstore';

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import fg from 'fast-glob';

// -------------------- CONFIG --------------------
const compileSass = gulpSass(dartSass);
const isDevelopment = process.env.NODE_ENV !== 'production';
const server = browser.create();

// -------------------- ERROR --------------------
function onError(task) {
    return function (err) {
        console.error(`[${task}]`, err?.message || err);
        this.emit('end');
    };
}

// -------------------- CLEAN --------------------
export const clean = () => deleteAsync('build');

// -------------------- HTML --------------------
export function processMarkup() {
    return gulp.src('source/*.html')
        .pipe(plumber({ errorHandler: onError('html') }))
        .pipe(htmlmin({
            collapseWhitespace: true,
            removeComments: true
        }))
        .pipe(gulp.dest('build'))
        .pipe(server.stream());
}

// -------------------- STYLES --------------------
export function processStyles() {
    return gulp.src('source/sass/**/*.scss', { sourcemaps: true })
        .pipe(plumber({ errorHandler: onError('styles') }))
        .pipe(compileSass({
            outputStyle: 'compressed'
        }))
        .pipe(postcss([
            postUrl({ url: 'rebase' }),
            autoprefixer(),
            csso()
        ]))
        .pipe(rename({ suffix: '.min' }))
        .pipe(gulp.dest('build/css', { sourcemaps: true }))
        .pipe(server.stream());
}

// -------------------- JS --------------------
export function processScripts() {
    return gulp.src('source/js/**/*.js', { sourcemaps: isDevelopment })
        .pipe(plumber({ errorHandler: onError('js') }))
        .pipe(gulpIf(!isDevelopment, terser()))
        .pipe(gulp.dest('build/js', { sourcemaps: isDevelopment }))
        .pipe(server.stream());
}

// -------------------- SVG --------------------
export function sprite() {
    return gulp.src('source/img/icons/*.svg')
        .pipe(svgo())
        .pipe(svgstore({ inlineSvg: true }))
        .pipe(rename('sprite.svg'))
        .pipe(gulp.dest('build/img'));
}

// -------------------- IMAGES HELPERS --------------------
async function processImages(format, encoder) {
    const files = fg.sync('source/img/**/*.{jpg,jpeg,png}')
        .filter(file => !file.includes('favicon'));

    for (const file of files) {
        const output = file
            .replace('source/img', `build/img/${format}`)
            .replace(/\.(jpg|jpeg|png)$/, `.${format}`);

        fs.mkdirSync(path.dirname(output), { recursive: true });

        await encoder(file, output);
    }
}

// -------------------- IMAGES --------------------
export function images() {
    const files = fg.sync('source/img/**/*.{jpg,jpeg,png}');

    for (const file of files) {
        const out = file.replace('source/img', 'build/img');

        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(file, out);
    }

    return Promise.resolve();
}

// -------------------- MODERN IMAGES --------------------
export async function modernImages() {
    const files = fg.sync('source/img/**/*.{jpg,jpeg,png}')
        .filter(file => !file.includes('favicon'));

    await Promise.all(files.map(async (file) => {
        const webpOut = file
            .replace('source/img', 'build/img/webp')
            .replace(/\.(jpg|jpeg|png)$/, '.webp');

        const avifOut = file
            .replace('source/img', 'build/img/avif')
            .replace(/\.(jpg|jpeg|png)$/, '.avif');

        fs.mkdirSync(path.dirname(webpOut), { recursive: true });
        fs.mkdirSync(path.dirname(avifOut), { recursive: true });

        await Promise.all([
            sharp(file).webp({ quality: 80 }).toFile(webpOut),
            sharp(file).avif({ quality: 80 }).toFile(avifOut)
        ]);
    }));
}

// -------------------- FAVICONS --------------------
export function copyFavicons() {
    const files = fg.sync('source/img/favicon/**/*.{png,ico,svg,webmanifest}');

    for (const file of files) {
        const out = file.replace('source/img/favicon', 'build/img/favicon');

        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(file, out);
    }

    const rootFavicon = 'source/favicon.ico';

    if (fs.existsSync(rootFavicon)) {
        fs.mkdirSync('build', { recursive: true });
        fs.copyFileSync(rootFavicon, 'build/favicon.ico');
    } return Promise.resolve();
}

// -------------------- FONTS --------------------
export function copyFonts() {
    return gulp.src('source/fonts/**/*.{woff,woff2,ttf,otf}')
        .pipe(gulp.dest('build/fonts'));
}

// -------------------- SERVER --------------------
export function startServer(done) {
    server.init({
        server: { baseDir: 'build' },
        port: 3000,
        notify: false,
        cors: true,
        ghostMode: false,
        open: false
    }, () => {
        exec('start chrome http://localhost:3000');
    });

    done();
}

// -------------------- WATCH --------------------
export function watchFiles() {
    gulp.watch('source/**/*.html', processMarkup);
    gulp.watch('source/sass/**/*.scss', processStyles);
    gulp.watch('source/js/**/*.js', processScripts);
}

// -------------------- BUILD --------------------
export const compileProject = gulp.series(
    clean,
    images,
    modernImages,
    gulp.parallel(
        processMarkup,
        processStyles,
        processScripts,
        copyFavicons,
        copyFonts,
        sprite
    )
);

// -------------------- PROD --------------------
export const buildProd = gulp.series(
    compileProject
);

// -------------------- DEV --------------------
export const runDev = gulp.series(
    compileProject,
    gulp.parallel(startServer, watchFiles)
);
