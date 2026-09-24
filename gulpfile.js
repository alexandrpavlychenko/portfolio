import gulp from 'gulp';
import plumber from 'gulp-plumber';
import gulpIf from 'gulp-if';

import bemlinter from 'gulp-html-bemlinter';
import { createRequire } from 'node:module';

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
import browserSync from 'browser-sync';
import { exec } from 'child_process';

import svgo from 'gulp-svgmin';
import svgstore from 'gulp-svgstore';
import { load } from 'cheerio';
import through2 from 'through2';
import Vinyl from 'vinyl';

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import fg from 'fast-glob';


const { src } = gulp;
const require = createRequire(import.meta.url);
const { htmlValidator } = require('gulp-w3c-html-validator');
const compileSass = gulpSass(dartSass);
const isDevelopment = process.env.NODE_ENV !== 'production';
const server = browserSync.create();


function onError(task) {
    return function (err) {
        console.error(`[${task}]`, err?.message || err);
        this.emit('end');
    };
}


export const clean = () => deleteAsync('build');


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


export function lintBem() {
    return src('source/**/*.html')
        .pipe(bemlinter());
}


export function validateMarkup() {
    return gulp.src('source/**/*.html')
        .pipe(htmlValidator.analyzer())
        .pipe(htmlValidator.reporter({ throwErrors: true }));
}


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


export function processScripts() {
    return gulp.src('source/js/**/*.js', { sourcemaps: isDevelopment })
        .pipe(plumber({ errorHandler: onError('js') }))
        .pipe(gulpIf(!isDevelopment, terser()))
        .pipe(gulp.dest('build/js', { sourcemaps: isDevelopment }))
        .pipe(server.stream());
}

export function sprite() {
    const iconsPath = 'source/img/icons';

    if (!fs.existsSync(iconsPath)) {
        return Promise.resolve();
    }

    return gulp.src('source/img/icons/*.svg', {allowEmpty: true})
        .pipe(svgo({
            full: true,
            plugins: []
        }))
        .pipe(svgstore({inlineSvg: true}))
        .pipe(through2.obj(function (file, encoding, callback) {
            const svg = file.contents.toString();

            const $ = load(svg, {
                xml: true
            });

            $('symbol').attr({
                'aria-hidden': 'true',
                'focusable': 'false'
            });

            file.contents = Buffer.from($.xml());

            callback(null, file);
        }))
        .pipe(rename('sprite.svg'))
        .pipe(gulp.dest('build/img/icons'));
}

export function spriteBg() {
    const iconsPath = 'source/img/icons';

    if (!fs.existsSync(iconsPath)) {
        return Promise.resolve();
    }

    const files = [];

    return gulp.src(`${iconsPath}/*.svg`, {allowEmpty: true})
        .pipe(svgo({
            full: true,
            plugins: []
        }))
        .pipe(through2.obj(function (file, encoding, callback) {
            files.push(file);
            callback();
        }, function (callback) {
            const $ = load('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
                xml: true
            });

            const root = $('svg');
            const size = 24;

            files.forEach((file, index) => {
                const svg = load(file.contents.toString(), {
                    xml: true
                });

                const id = file.stem;
                const offset = index * size;

                svg('path').each((_, path) => {
                    const pathElement = svg(path);

                    if (offset !== 0) {
                        pathElement.attr('transform', `translate(0 ${offset})`);
                    }

                    root.append(pathElement);
                });

                root.append(
                    $('<view>').attr({
                        id: `${id}-view`,
                        viewBox: `0 ${offset} ${size} ${size}`
                    })
                );
            });

            root.attr('viewBox', `0 0 ${size} ${files.length * size}`);

            const output = new Vinyl({
                path: 'sprite-bg.svg',
                contents: Buffer.from($.xml())
            });

            this.push(output);
            callback();
        }))
        .pipe(gulp.dest('build/img/icons'));
}

export async function images() {
    const files = fg.sync('source/img/**/*.{jpg,jpeg,png}')
        .filter(file => !file.includes('favicon'));

    for (const file of files) {
        const out = file.replace('source/img', 'build/img');

        fs.mkdirSync(path.dirname(out), { recursive: true });

        const ext = path.extname(file).toLowerCase();

        try {
            if (ext === '.jpg' || ext === '.jpeg') {
                await sharp(file)
                    .jpeg({ quality: 80 })
                    .toFile(out);
            } else if (ext === '.png') {
                await sharp(file)
                    .png({ compressionLevel: 9 })
                    .toFile(out);
            } else {
                fs.copyFileSync(file, out);
            }
        } catch (err) {
            console.error('Image processing error:', file, err);
            fs.copyFileSync(file, out);
        }
    }

    return Promise.resolve();
}


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
            sharp(file)
                .resize({ withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(webpOut),

            sharp(file)
                .resize({ withoutEnlargement: true })
                .avif({ quality: 80 })
                .toFile(avifOut)
        ]);
    }));
}


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


export function copyFonts() {
    return gulp.src('source/fonts/**/*.{woff,woff2,ttf,otf}', { encoding: false })
        .pipe(gulp.dest('build/fonts'));
}


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


export function watchFiles() {
    gulp.watch('source/**/*.html', processMarkup);
    gulp.watch('source/sass/**/*.scss', processStyles);
    gulp.watch('source/js/**/*.js', processScripts);
}


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
        sprite,
        spriteBg
    ),
    validateMarkup,
    lintBem
);


export const buildProd = gulp.series(
    compileProject
);


export const runDev = gulp.series(
    compileProject,
    gulp.parallel(startServer, watchFiles)
);
