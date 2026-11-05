import { Component } from '@angular/core';
import { Toolbar } from '../../utils/toolbar/toolbar';
import { RouterOutlet } from '@angular/router';
import { Dashboard } from '../../utils/dashboard/dashboard';

@Component({
  imports: [Toolbar, RouterOutlet, Dashboard],
  selector: 'app-content',
  templateUrl: './content.html',
})
export class Content {}
